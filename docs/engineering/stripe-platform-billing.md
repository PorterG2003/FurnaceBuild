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

Platform invite activation currently completes through the shared Stripe reconciler:

1. Checkout creates/resumes a durable `platform_invite_checkout_attempts` row
2. Customer returns from Stripe (`?checkout=return&session_id=...`, legacy `?checkout=success` still works)
3. Webhook events and authenticated page refresh call the same reconciler
4. Reconciler normalizes Checkout Session + PaymentIntent into a phase
5. Provisioning happens only for card paid or ACH `processing`/`succeeded`
6. `complete_platform_invitation(...)` creates the account/membership idempotently
7. Success UI polls membership and enters the workspace

ACH microdeposit verification is a first-class recoverable phase (`verification_required`) with Stripe's hosted verification URL. Failed/expired attempts allow one controlled replacement checkout without changing the signed agreement.

Free invites are the exception: a `$0` retainer bypasses Stripe entirely and activates through `accept_platform_invitation(...)`. These accounts do not get a Stripe subscription until they are later upgraded to a paid retainer.

## Invite proration modes

Each invite carries `platform_invitations.proration_mode`, chosen by the admin in the invite wizard and snapshotted onto every revision. `buildBillingAnchorPlan(startedAt, retainerCents, mode)` in [`lib/billing/proration.ts`](../../lib/billing/proration.ts) is the single source of truth for both modes; every quote, checkout session, preview, and breakdown derives from it.

| Mode | Due today | First recurring invoice (1st MST) |
|------|-----------|-----------------------------------|
| `second_month` (default) | Full retainer | Retainer minus an overlap credit, applied as a once-off Stripe coupon |
| `first_month` | `round(retainer x remaining signup-month days / days in month)` | Full retainer, no coupon |

Rules that apply to both modes:

- Existing invites and any invite created without an explicit mode stay `second_month`. The default must not change.
- The two modes are **not** revenue-equivalent. `second_month` computes its credit against the *anchor* month's day count while `first_month` prorates against the *signup* month, so a `$1,800` retainer accepted Aug 15 bills `$2,760.00` versus `$2,787.10` through Sep 30. Tests assert exact per-mode values rather than equality between modes.
- Accepting on the 1st MST is not a prorated case in either mode: due today is a full retainer and the credit is `$0`. UI copy is driven by `dueTodayCoveredDays < dueTodayMonthDays`, never by the mode itself, so this case renders identical clean copy in both.
- A late-month `first_month` accept on a small retainer can round below Stripe's `$0.50` minimum. `buildBillingAnchorPlan` clamps it, which keeps the admin preview, the customer quote, and the actual charge in agreement.
- The agreement text is snapshotted at publish, so `applyProrationModeToTermsMarkdown` swaps the stock proration clause when the admin changes the mode. Hand-edited agreements are left untouched and the wizard warns instead.
- The once-off coupon must not be created when the discount is `0`. `resolveInviteRecurringCouponAmountCents` owns that decision.

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

- drive UI from normalized checkout phase, never from the return query param alone
- show verification, processing, activation, failure, and retry states explicitly
- add a timeout or retry state
- show a human-readable failure message
- never leave the user on an indefinite loading screen after the polling window ends

After provisioning creates or grants membership, call `useEnterWorkspace().enterWorkspace(...)` from [`lib/account/useEnterWorkspace.ts`](../../lib/account/useEnterWorkspace.ts) before navigating into `(main)`. That helper polls for DB visibility and refreshes `AccountContext` via `refetch()`. DB visibility alone is insufficient — stale client context will still hit `/no-workspace`.

Support recovery for interrupted checkouts:

```bash
INVITATION_ID=<uuid> npx tsx scripts/reconcile-platform-invite-checkout.ts
INVITATION_ID=<uuid> APPLY=true npx tsx scripts/reconcile-platform-invite-checkout.ts
```

Dry-run first. Apply only after confirming the printed Stripe phase and proposed Furnace transition.

## Current key files

- `amplify/functions/platformCommerce/handler.ts`
- `amplify/functions/stripeWebhook/handler.ts`
- `lib/billing/inviteCheckoutPhase.ts`
- `lib/billing/inviteCheckoutRecoveryCopy.ts`
- `lib/billing/reconcileInviteCheckout.ts`
- `lib/billing/stripeCoupons.ts`
- `app/accept-platform-invite/[id].tsx`
- `components/platform/invite/PlatformInviteRecoveryStep.tsx`
- `scripts/reconcile-platform-invite-checkout.ts`
- `scripts/seed/scenarios/platform-invite-preview.ts`
- `app/accept-account-amendment/[id].tsx`
- `components/platform/invite/PlatformInviteExperience.tsx`
- `components/platform/amendment/PlatformAmendmentUpgradePaymentStep.tsx`
- `components/platform/admin/wizard/steps/invite/InviteBillingStep.tsx`
- `lib/billing/amendmentQuote.ts`
- `lib/billing/calendar.ts`
- `lib/billing/paymentRoutes.ts`
- `lib/billing/proration.ts`
- `lib/platform/invite/priceSections.ts`
- `lib/platform/invite/prorationSummary.ts`
- `lib/platform/contract/terms.ts`
- `lib/billing/proration.test.ts`
- `lib/billing/paymentRoutes.test.ts`
- `lib/billing/inviteCheckoutPhase.test.ts`
- `lib/billing/inviteCheckoutRecovery.test.ts`
- `lib/platform/contract/terms.test.ts`
- `lib/platform/invite/priceSections.test.ts`
- `lib/platform/invite/prorationSummary.test.ts`
- `lib/platform/invite/preview.test.ts`
- `lib/test/platform/accountAmendmentOutcomes.test.ts`
- `lib/test/platform/platformInviteOutcomes.test.ts`
- `lib/test/platform/platformInviteCheckoutAttemptOutcomes.test.ts`
- `lib/account/useEnterWorkspace.ts`
- `lib/account/membershipActivation.ts`
