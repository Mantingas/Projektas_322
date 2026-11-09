import { Inflate } from 'fflate';
import { ParseError } from './errors';

/** Limits against decompression bombs and abusive archives. */
export const ZIP_LIMITS = {
  maxEntries: 1000,
  /** Real (measured) decompressed bytes, not declared ones. */
  maxTotalUncompressed: 150 * 1024 * 1024,
  maxEntryUncompressed: 80 * 1024 * 1024,
  /** Entries larger than minBytesForRatio must not compress better than this. */
  maxRatio: 100,
  minBytesForRatio: 5 * 1024 * 1024,
  maxNameLength: 300,
  /** Compressed bytes fed per step: deflate expands at most ~1000:1, so one step can never produce more than a few MB. */
  chunk: 4 * 1024,
  /** Wall-clock budget for inspecting the archive. */
  maxMillis: 10_000,
};

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

interface Entry {
  name: string;
  method: number;
  comp: number;
  uncomp: number;
  localOffset: number;
}

function readDirectory(bytes: Uint8Array): Entry[] {
  const min = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= min; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 5 && bytes[i + 3] === 6) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ParseError('corrupt_file');
  const entries = u16(bytes, eocd + 10);
  const cdOffset = u32(bytes, eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) throw new ParseError('zip_limits'); // ZIP64: not needed for ordinary workbooks
  if (entries > ZIP_LIMITS.maxEntries) throw new ParseError('zip_limits');
  const out: Entry[] = [];
  const seen = new Set<string>();
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new ParseError('corrupt_file');
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const comp = u32(bytes, p + 20);
    const uncomp = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const next = p + 46 + nameLen + u16(bytes, p + 30) + u16(bytes, p + 32);
    if (comp === 0xffffffff || uncomp === 0xffffffff) throw new ParseError('zip_limits');
    if (flags & 1) throw new ParseError('password_protected');
    if (method !== 0 && method !== 8) throw new ParseError('unsafe_archive'); // only stored / deflate are valid in OOXML
    if (nameLen === 0 || nameLen > ZIP_LIMITS.maxNameLength || p + 46 + nameLen > bytes.length) throw new ParseError('unsafe_archive');
    const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLen));
    // path traversal / absolute paths / control characters
    // eslint-disable-next-line no-control-regex
    if (name.startsWith('/') || name.startsWith('\\') || /(^|[\\/])\.\.([\\/]|$)/.test(name) || /^[a-z]:/i.test(name) || /[\u0000-\u001f]/.test(name)) throw new ParseError('unsafe_archive');
    const lower = name.toLowerCase();
    if (seen.has(lower)) throw new ParseError('unsafe_archive'); // duplicate names make different readers see different content
    seen.add(lower);
    out.push({ name, method, comp, uncomp, localOffset: u32(bytes, p + 42) });
    p = next;
  }
  return out;
}

/**
 * Validates the archive WITHOUT trusting its declared sizes: every deflated entry is actually inflated in small steps and
 * its real output is counted and discarded. Rejects when real size exceeds the declaration, the per-entry / total cap, or the
 * time budget. Also rejects encrypted entries, unsupported methods, unsafe or duplicate names, and archives that are not workbooks.
 * Residual risk: the parser that follows (ExcelJS) inflates again; memory for legitimate, large sheets is bounded only by these caps.
 */
export function inspectZip(bytes: Uint8Array, limits: Partial<typeof ZIP_LIMITS> = {}): void {
  const L = { ...ZIP_LIMITS, ...limits };
  const deadline = now() + L.maxMillis;
  const entries = readDirectory(bytes);
  // cheap checks on the declared sizes first
  let declared = 0;
  for (const e of entries) {
    declared += e.uncomp;
    if (e.uncomp > L.maxEntryUncompressed || declared > L.maxTotalUncompressed) throw new ParseError('zip_limits');
    if (e.uncomp > L.minBytesForRatio && e.uncomp / Math.max(e.comp, 1) > L.maxRatio) throw new ParseError('zip_limits');
  }
  const names = new Set(entries.map((e) => e.name.toLowerCase()));
  if (!names.has('[content_types].xml') || !names.has('xl/workbook.xml')) throw new ParseError('corrupt_file');

  // then verify with REAL decompressed byte counts: the declaration may lie
  let total = 0;
  for (const e of entries) {
    const lo = e.localOffset;
    if (lo + 30 > bytes.length || u32(bytes, lo) !== 0x04034b50) throw new ParseError('corrupt_file');
    const start = lo + 30 + u16(bytes, lo + 26) + u16(bytes, lo + 28);
    const end = start + e.comp;
    if (end > bytes.length) throw new ParseError('corrupt_file');
    if (e.method === 0) {
      if (e.comp !== e.uncomp) throw new ParseError('corrupt_file');
      total += e.comp;
      if (total > L.maxTotalUncompressed) throw new ParseError('zip_limits');
      continue;
    }
    let real = 0;
    const isXml = /\.(xml|rels|vml)$/i.test(e.name);
    let tail = '';
    const inflate = new Inflate((chunk) => {
      real += chunk.length;
      total += chunk.length;
      if (real > e.uncomp + 1024 || real > L.maxEntryUncompressed || total > L.maxTotalUncompressed) throw new ParseError('zip_limits');
      // OOXML never needs a DTD: refuse entity declarations (XML entity-expansion / XXE) before any parser sees them
      if (isXml && real <= 4 * 1024 * 1024) {
        const text = tail + new TextDecoder('latin1').decode(chunk);
        if (/<!(DOCTYPE|ENTITY)/i.test(text)) throw new ParseError('unsafe_archive');
        tail = text.slice(-10);
      }
    });
    try {
      for (let o = start; o < end; o += L.chunk) {
        if (now() > deadline) throw new ParseError('timeout');
        inflate.push(bytes.subarray(o, Math.min(end, o + L.chunk)), o + L.chunk >= end);
      }
    } catch (err) {
      if (err instanceof ParseError) throw err;
      throw new ParseError('corrupt_file');
    }
    if (real !== e.uncomp) throw new ParseError('zip_limits'); // declared size lied (or data is damaged)
  }
}
