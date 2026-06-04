# Stripe platform billing

Canonical rules for Stripe-backed platform billing flows in Furnace: invite checkout, recurring subscription setup, amendment deltas, and webhook-driven activation.

See also: [test-convention.md](./test-convention.md), [../platform/README.md](../platform/README.md).

## Scope

This standard applies to:

- `amplify/functions/platformCommerce/`
- `amplify/functions/stripeWebhook/`
- `lib/billing/`
- `lib/test/platform/`

## Core invariants

1. A paid platform invite must not rely on an unvalidated Stripe request shape.
2. Full identifiers belong in Stripe `metadata`, not long human-facing `name` fields.
3. Any webhook-only business-critical path must have at least one handler-level regression test.
4. Any async post-payment activation screen must surface timeout or failure state, not an infinite spinner.
5. Account amendment upgrades must use the shared MST quote helpers under `lib/billing/` for both preview and charging.
6. Payment-method replacement for an existing account must use setup-mode Checkout and synchronize both Stripe customer and subscription defaults.

## External API constraints checklist

Before shipping a Stripe billing change:

1. Check the Stripe docs for every touched object field with user- or ID-derived content.
2. Keep display strings short and deterministic.
3. Put the full `invitationId`, `accountId`, revision IDs, and other long references in `metadata`.
4. If a field has a max length, encode that limit in code or a helper instead of relying on memory.
5. Reuse a shared helper when the same constraint applies in more than one call site.

## Stripe naming rules

- Coupon `name` values must stay within Stripe limits.
- Do not interpolate raw UUIDs into Stripe display names.
- Prefer compact labels such as `Platform invite recurring d064dcc6`.
- Preserve the full identifier in `metadata`.

## Platform invite completion rule

Platform invite activation currently completes in the Stripe webhook path:

1. checkout succeeds
2. webhook creates or reuses recurring Stripe objects
3. webhook calls `complete_platform_invitation(...)`
4. owner membership appears
5. success screen redirects

Because this path is webhook-only, any change to Stripe object creation or metadata parsing must include handler-level test coverage.

Free invites are the exception: a `$0` retainer bypasses Stripe entirely and activates through `accept_platform_invitation(...)`. These accounts do not get a Stripe subscription until they are later upgraded to a paid retainer.

## Account amendment payment rule

Account amendment upgrades now have two distinct payment behaviors:

1. Card-like methods remain synchronous: commerce applies the delta charge, updates the subscription amount, and completes the amendment in the same request.
2. ACH remains async after initiation: commerce provisions the upgrade on successful initiation, while webhooks reconcile the late `invoice.paid` or `invoice.payment_failed` outcome.

Late ACH failure must move the account to `payment_required`; it must not silently revert the accepted amendment.

## Testing checklist

Every Stripe/platform billing change should include the right mix of tests:

- Colocated unit tests for pure billing math and Stripe-safe parameter builders
- Handler-level tests for webhook parameter generation or side-effect branching
- Domain outcome tests under `lib/test/platform/` when DB truth or invitation/account lifecycle changes
- Scenario-driven unit coverage for fee-inclusive amendment quotes and MST date boundaries

Minimum validation for billing/webhook changes:

1. Run focused unit tests for the touched billing or webhook helpers
2. Run `npm run test:platform`
3. If React invite UX changed, run `npx react-doctor@latest --verbose --diff`

## Activation UX rule

If a customer-visible success screen depends on asynchronous provisioning:

- add a timeout or retry state
- show a human-readable failure message
- never leave the user on an indefinite loading screen after the polling window ends

## Current key files

- `amplify/functions/platformCommerce/handler.ts`
- `amplify/functions/stripeWebhook/handler.ts`
- `app/accept-platform-invite/[id].tsx`
- `app/accept-account-amendment/[id].tsx`
- `components/platform/invite/PlatformInviteExperience.tsx`
- `components/platform/amendment/PlatformAmendmentUpgradePaymentStep.tsx`
- `lib/billing/amendmentQuote.ts`
- `lib/billing/calendar.ts`
- `lib/billing/paymentRoutes.ts`
- `lib/test/platform/accountAmendmentOutcomes.test.ts`
- `lib/test/platform/platformInviteOutcomes.test.ts`
