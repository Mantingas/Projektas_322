import { ParseError } from './errors';

/** Limits against decompression bombs. */
export const ZIP_LIMITS = {
  maxEntries: 1000,
  maxTotalUncompressed: 200 * 1024 * 1024,
  maxEntryUncompressed: 120 * 1024 * 1024,
  /** Entries larger than minBytesForRatio must not compress better than this. */
  maxRatio: 100,
  minBytesForRatio: 5 * 1024 * 1024,
};

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/**
 * Reads the ZIP central directory WITHOUT inflating anything and rejects archives whose declared sizes are abusive.
 * Residual risk: declared sizes come from the file itself; a deliberately lying header is not caught here.
 */
export function inspectZip(bytes: Uint8Array): void {
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
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ParseError('zip_limits'); // ZIP64: not needed for ordinary workbooks
  if (entries > ZIP_LIMITS.maxEntries) throw new ParseError('zip_limits');
  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new ParseError('corrupt_file');
    const comp = u32(bytes, p + 20);
    const uncomp = u32(bytes, p + 24);
    if (comp === 0xffffffff || uncomp === 0xffffffff) throw new ParseError('zip_limits');
    total += uncomp;
    if (uncomp > ZIP_LIMITS.maxEntryUncompressed || total > ZIP_LIMITS.maxTotalUncompressed) throw new ParseError('zip_limits');
    if (uncomp > ZIP_LIMITS.minBytesForRatio && uncomp / Math.max(comp, 1) > ZIP_LIMITS.maxRatio) throw new ParseError('zip_limits');
    p += 46 + u16(bytes, p + 28) + u16(bytes, p + 30) + u16(bytes, p + 32);
  }
}
