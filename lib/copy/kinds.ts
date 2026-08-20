export const COPY_PIECE_KINDS = [
  'subject',
  'hook',
  'problem',
  'proof',
  'offer',
  'cta',
] as const;

export type CopyPieceKind = (typeof COPY_PIECE_KINDS)[number];

const COPY_PIECE_KIND_SET = new Set<string>(COPY_PIECE_KINDS);

export function isCopyPieceKind(value: unknown): value is CopyPieceKind {
  return typeof value === 'string' && COPY_PIECE_KIND_SET.has(value);
}

export const COPY_PIECE_KIND_LABELS: Record<CopyPieceKind, string> = {
  subject: 'Subjects',
  hook: 'Hooks',
  problem: 'Problems',
  proof: 'Proof',
  offer: 'Offers',
  cta: 'CTAs',
};
