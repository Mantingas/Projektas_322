import { describe, expect, it } from 'vitest';
import { parseFile } from '@/engine/parsing/parseFile';
import { analyzeSheet } from '@/engine/pipeline';
import { LOW_CONFIDENCE } from '@/engine/mapping/mapper';

async function propose(header: string) {
  const csv = `Data;Klientas;${header};Suma be PVM\r\n2025-01-02;A;X1;10,00\r\n2025-01-03;B;X2;20,00\r\n2025-01-04;C;X3;30,00\r\n`;
  const a = analyzeSheet((await parseFile(new TextEncoder().encode(csv), 'x.csv')).sheets[0]!)!;
  return a.proposal.entries.find((e) => e.columnIndex === 2);
}

describe('identifier columns are never proposed with false confidence', () => {
  it('a generic "… kodas" header is proposed only as a low-confidence suggestion', async () => {
    const e = await propose('Vidinis kodas');
    expect(e).toBeDefined();
    expect(e!.confidence).toBeLessThan(LOW_CONFIDENCE);
  });
  it('exact identifier headers keep high confidence', async () => {
    for (const h of ['Prekės kodas', 'Kod towaru', 'SKU']) expect((await propose(h))!.confidence, h).toBeGreaterThanOrEqual(LOW_CONFIDENCE);
  });
});
