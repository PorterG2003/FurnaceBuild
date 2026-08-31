export type FreeFlag = boolean | null;

const FREE_RE =
  /\b(free(?: of charge)?|no cost|complimentary|\$0(?:\.00)?|at no charge|no registration fee)\b/i;
const PAID_RE =
  /\b(tuition|course fee|registration fee|price:|priced at|enroll for \$|add to cart|buy (this )?course|\$\d{2,})\b/i;

export function detectIsFree(text: string): FreeFlag {
  const free = FREE_RE.test(text);
  const paid = PAID_RE.test(text);
  if (free && !paid) return true;
  if (paid && !free) return false;
  if (free && paid) return true;
  return null;
}
