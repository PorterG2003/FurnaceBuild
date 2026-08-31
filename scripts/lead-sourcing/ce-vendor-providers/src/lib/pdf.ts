import { spawnSync } from 'node:child_process';

/** Turn a PDF buffer into text via pdftotext when present. */
export function pdfBufferToText(pdf: Buffer): string {
  const result = spawnSync('pdftotext', ['-layout', '-', '-'], {
    input: pdf,
    encoding: 'utf8',
    maxBuffer: 20_000_000,
  });
  if (result.status !== 0) return '';
  return result.stdout ?? '';
}

export function looksLikePdf(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-';
}
