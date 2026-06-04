# Account Amendment Billing Scenarios

Golden product scenarios for account amendment billing, checkout, and payment recovery.

This document is intentionally written as a target behavior spec, not a description of the current implementation. Use it to drive:

- billing math helpers
- customer checkout UX
- Stripe orchestration behavior
- webhook reconciliation
- regression tests

See also: `docs/engineering/stripe-platform-billing.md`, `docs/platform/README.md`.

## Scope

These scenarios cover:

- no-billing-change amendments
- downgrades
- upgrades
- payment recovery for failed upgrades
- billing timezone edge cases
- billing method changes during checkout
- idempotency and reload safety

These scenarios do not prescribe the exact Stripe API shape. They define the outcomes the product must guarantee.

## Billing Assumptions

1. The billing timezone is `MST`.
2. The billing anchor is the `1st of the month` in `MST`.
3. Day counts for proration use `MST` calendar days, not raw UTC dates.
4. A `terms-only` or `same-price` amendment does not require payment.
5. A `downgrade` does not create an immediate refund. It takes effect on the next billing cycle.
6. An `upgrade` takes effect immediately after successful payment.
7. For upgrades:
   - `due_today_subtotal = new_monthly_retainer - old_monthly_retainer`
   - `next_invoice_credit_subtotal = delta * elapsed_days / days_in_month`
   - `next_invoice_subtotal = new_monthly_retainer - next_invoice_credit_subtotal`
8. `elapsed_days` means the number of full `MST` calendar days already elapsed in the current month before the amendment becomes effective. Example: an upgrade accepted on May 5 has `elapsed_days = 4`.
9. Round currency values to the nearest cent after the proration multiplication.
10. Every customer-facing checkout or payment retry screen must let the client change the billing method before confirming payment.
11. A successful billing method change must be used consistently for:
   - the immediate charge being confirmed
   - future recurring invoices
   - future amendment retries
12. Customer-facing amendment totals are route-aware:
   - card totals include the configured card processing fee
   - ACH totals include the configured ACH fee (currently zero in Furnace)
   - the immediate charge, next invoice credit, and ongoing recurring amount must all use the same effective billing route
13. ACH upgrades are provisioned on initiation:
   - the amendment becomes `accepted` once the ACH-backed upgrade is successfully initiated
   - if the ACH debit later fails, the amendment stays accepted but the account moves to `payment_required` / blocked recovery

## Global Invariants

Every scenario below should satisfy all of these invariants:

- no double charge
- no silent undercharge
- no overcharge across the month boundary
- amendment status only becomes `accepted` after the economic requirement is satisfied
- retries are idempotent
- reloads after a successful payment do not create a second charge
- the checkout preview and the actual charged outcome use the same billing date basis and math
- the effective billing method after checkout is unambiguous
- ACH late failures reconcile into a blocked recovery state instead of silently reverting economic state

## Scenario Set

Each section contains two concrete scenarios for the same product case.

### 1. No Billing Change

#### Scenario 1A: Terms-only amendment

- Current monthly retainer: `$3,000.00`
- Proposed monthly retainer: `$3,000.00`
- Terms changed: yes
- Expected:
  - no payment step
  - amendment is accepted immediately
  - no Stripe charge is created
  - next invoice remains `$3,000.00`

#### Scenario 1B: Proposal change with same price

- Current monthly retainer: `$5,000.00`
- Proposed monthly retainer: `$5,000.00`
- Proposal snapshot changed: yes
- Expected:
  - no payment step
  - amendment is accepted immediately
  - no Stripe charge is created
  - next invoice remains `$5,000.00`

### 2. Downgrade

#### Scenario 2A: Mid-month downgrade

- Current monthly retainer: `$5,000.00`
- Proposed monthly retainer: `$3,000.00`
- Amendment accepted on `May 15` MST
- Expected:
  - no immediate refund
  - no immediate charge
  - amendment is accepted immediately
  - current cycle remains at `$5,000.00`
  - next invoice on `June 1` MST is `$3,000.00`

#### Scenario 2B: Late-month downgrade

- Current monthly retainer: `$6,500.00`
- Proposed monthly retainer: `$4,000.00`
- Amendment accepted on `Feb 27` MST
- Expected:
  - no immediate refund
  - no immediate charge
  - amendment is accepted immediately
  - current cycle remains at `$6,500.00`
  - next invoice on `March 1` MST is `$4,000.00`

### 3. Upgrade With Valid Billing Method

#### Scenario 3A: Early-month upgrade

- Current monthly retainer: `$3,000.00`
- Proposed monthly retainer: `$5,000.00`
- Delta: `$2,000.00`
- Amendment accepted on `May 5` MST
- May day count: `31`
- Elapsed days: `4`
- Expected:
  - due today subtotal: `$2,000.00`
  - next invoice credit: `4 / 31 * $2,000.00 = $258.06`
  - next invoice amount: `$5,000.00 - $258.06 = $4,741.94`
  - if the billing route is `card`, the customer-facing due-today and next-invoice totals also include the card fee
  - amendment becomes `accepted` after successful payment

#### Scenario 3B: Late-month upgrade

- Current monthly retainer: `$3,000.00`
- Proposed monthly retainer: `$5,000.00`
- Delta: `$2,000.00`
- Amendment accepted on `May 28` MST
- May day count: `31`
- Elapsed days: `27`
- Expected:
  - due today subtotal: `$2,000.00`
  - next invoice credit: `27 / 31 * $2,000.00 = $1,741.94`
  - next invoice amount: `$5,000.00 - $1,741.94 = $3,258.06`
  - if the billing route is `card`, the customer-facing due-today and next-invoice totals also include the card fee
  - amendment becomes `accepted` after successful payment

### 4. Upgrade Requiring Billing Method Change

#### Scenario 4A: Saved card fails, customer replaces it, retry succeeds

- Current monthly retainer: `$3,000.00`
- Proposed monthly retainer: `$5,000.00`
- Delta: `$2,000.00`
- Amendment accepted on `May 15` MST
- First saved billing method attempt fails
- Customer changes billing method during retry
- May day count: `31`
- Elapsed days: `14`
- Expected:
  - first attempt leaves amendment in a recoverable payment state
  - no duplicate charge is created
  - retry can be completed after changing billing method
  - due today subtotal on the successful retry: `$2,000.00`
  - next invoice credit: `14 / 31 * $2,000.00 = $903.23`
  - next invoice amount: `$5,000.00 - $903.23 = $4,096.77`
  - the displayed and charged totals use the replacement route (for example card fee on card, zero fee on ACH)
  - all future recurring charges use the replacement billing method

#### Scenario 4B: No usable saved method, customer adds one, retry succeeds

- Current monthly retainer: `$5,000.00`
- Proposed monthly retainer: `$6,500.00`
- Delta: `$1,500.00`
- Amendment accepted on `Feb 20` MST during a `28-day` February
- No valid reusable billing method exists at first
- Customer adds a new billing method before retrying
- Elapsed days: `19`
- Expected:
  - first attempt leaves amendment in a recoverable payment state
  - retry can be completed after adding a billing method
  - due today subtotal on the successful retry: `$1,500.00`
  - next invoice credit: `19 / 28 * $1,500.00 = $1,017.86`
  - next invoice amount: `$6,500.00 - $1,017.86 = $5,482.14`
  - the displayed and charged totals use the newly selected route
  - all future recurring charges use the newly added billing method

### 5. Calendar Boundary And Proration Edge Cases

#### Scenario 5A: Leap-year February

- Current monthly retainer: `$4,000.00`
- Proposed monthly retainer: `$6,000.00`
- Delta: `$2,000.00`
- Amendment accepted on `Feb 20, 2028` MST
- February day count: `29`
- Elapsed days: `19`
- Expected:
  - due today: `$2,000.00`
  - next invoice credit: `19 / 29 * $2,000.00 = $1,310.34`
  - next invoice amount: `$6,000.00 - $1,310.34 = $4,689.66`

#### Scenario 5B: Midnight boundary uses MST, not UTC

- Current monthly retainer: `$3,000.00`
- Proposed monthly retainer: `$5,000.00`
- Delta: `$2,000.00`
- Acceptance instant: `2026-06-01T01:30:00Z`
- Local billing interpretation: still `May 31` in `MST`
- May day count: `31`
- Elapsed days: `30`
- Expected:
  - proration uses `May 31` behavior, not `June 1` behavior
  - due today: `$2,000.00`
  - next invoice credit: `30 / 31 * $2,000.00 = $1,935.48`
  - next invoice amount: `$5,000.00 - $1,935.48 = $3,064.52`
  - preview math and final charge outcome must match

### 6. Billing Method Choice At Checkout

#### Scenario 6A: Customer swaps from an old saved card to a new saved card before confirming

- Current monthly retainer: `$3,000.00`
- Proposed monthly retainer: `$5,000.00`
- Delta: `$2,000.00`
- Checkout initially shows saved billing method `Card A`
- Customer changes billing method to `Card B` before confirming
- Expected:
  - the successful immediate charge uses `Card B`
  - the next recurring invoice uses `Card B`
  - future amendment retries use `Card B`
  - `Card A` is no longer the effective default method for this subscription/account
  - the payment preview is recomputed against `Card B` before confirmation

#### Scenario 6B: Customer changes billing method during payment recovery

- Current monthly retainer: `$4,000.00`
- Proposed monthly retainer: `$5,000.00`
- Delta: `$1,000.00`
- Initial retry screen shows an unusable saved billing method
- Customer changes billing method before confirming the recovery attempt
- Expected:
  - the recovery attempt uses the replacement billing method
  - the recurring subscription uses that same replacement billing method afterward
  - the amendment is accepted once the replacement method succeeds
  - the retry preview is recomputed against the replacement method before confirmation

### 7. Idempotency And Reload Safety

#### Scenario 7A: Double submit

- Current monthly retainer: `$3,000.00`
- Proposed monthly retainer: `$5,000.00`
- Delta: `$2,000.00`
- Customer taps confirm twice or the client retries the request
- Expected:
  - only one immediate charge is collected
  - only one amendment acceptance is recorded
  - only one next-invoice credit is applied

#### Scenario 7B: Payment succeeds but redirect/reload is interrupted

- Current monthly retainer: `$3,000.00`
- Proposed monthly retainer: `$5,000.00`
- Delta: `$2,000.00`
- Payment succeeds, but the client never reaches the success screen
- Customer reloads the amendment link
- Expected:
  - system recognizes the existing successful charge
  - no second charge is created
  - amendment resolves to the completed state
  - next invoice still contains exactly one correct credit

## Suggested Test Layers

Use the same scenarios across multiple layers so behavior stays aligned.

### Pure math tests

Validate:

- `elapsed_days`
- `days_in_month`
- `next_invoice_credit`
- `next_invoice_amount`
- rounding to cents
- `MST` day-boundary handling

### Domain outcome tests

Validate:

- amendment status transitions
- accepted versus recoverable payment states
- scheduled downgrade behavior
- upgrade completion behavior
- reload safety after success

### Stripe orchestration tests

Validate:

- one immediate charge per successful upgrade
- billing method changes are respected at confirmation time
- future recurring invoices use the chosen billing method
- retries do not duplicate invoices or acceptance side effects

### Webhook reconciliation tests

Validate:

- the next invoice receives the expected one-time credit
- no duplicate credit is applied
- payment failure leaves the amendment recoverable
- payment success resolves the amendment cleanly

## Open Product Questions

If any of these answers change, update this document before updating code or tests:

1. Should billing method changes include both payment-method replacement and payment-route changes?
2. Should route-specific processing fees be modeled in the same golden scenarios, or layered as a separate quote test suite?
3. Should an upgrade update the recurring subscription immediately after the successful charge, or only after webhook reconciliation confirms the charge?
