export type StripeWebhookSubscriptionDiff = {
  current: string[];
  missing: string[];
  extra: string[];
  merged: string[];
  hasWildcard: boolean;
};

export function diffStripeWebhookSubscriptions(args: {
  required: readonly string[];
  current: readonly string[];
}): StripeWebhookSubscriptionDiff {
  const current: string[] = [];
  const seen = new Set<string>();
  for (const event of args.current) {
    if (seen.has(event)) continue;
    seen.add(event);
    current.push(event);
  }

  const hasWildcard = seen.has('*');
  const requiredSet = new Set(args.required);
  const missing = hasWildcard
    ? []
    : args.required.filter((event) => !seen.has(event));
  const extra = current.filter((event) => event !== '*' && !requiredSet.has(event));
  const merged = hasWildcard ? [...current] : [...current, ...missing];

  return {
    current,
    missing,
    extra,
    merged,
    hasWildcard,
  };
}
