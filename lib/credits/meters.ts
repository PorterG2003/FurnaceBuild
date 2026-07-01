/**
 * Credit meters are the keys that scope the generic credit system. Each metered
 * feature gets one stable string here plus a `credit_entitlements` row in the DB.
 *
 * To add a new meter: add a key below, seed a global default entitlement in a
 * migration, and call `consume_credit(accountId, meter, ...)` from the server.
 * See `docs/engineering/credits.md`.
 */
export const CREDIT_METERS = {
  apolloEnrichment: 'apollo_enrichment',
} as const;

export type CreditMeter = (typeof CREDIT_METERS)[keyof typeof CREDIT_METERS];

/**
 * UI fallback allowances, used only when the live balance can't be read yet.
 * The source of truth for limits is the `credit_entitlements` table.
 */
export const DEFAULT_MONTHLY_GRANTS: Record<CreditMeter, number> = {
  [CREDIT_METERS.apolloEnrichment]: 100,
};
