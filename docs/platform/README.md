# Platform domain

Commercial platform onboarding: client invites, account amendments, shared contract terms, and admin account management.

## Folder map

| Path | Purpose |
|------|---------|
| `lib/platform/contract/` | Shared commercial terms, proposal plans, `PlatformContractViewData` |
| `lib/platform/invite/` | Invite wizard, admin state, preview helpers |
| `lib/platform/amendment/` | Amendment wizard, accept flow |
| `lib/platform/wizard/` | Platform-specific contract snapshot builder |
| `lib/billing/` | Shared billing calendar, invite quote math, amendment quote math, route fees |
| `lib/wizard/` | Generic wizard navigation + draft storage |
| `lib/supabase/services/platform/` | Supabase RPCs (invitations, amendments, billing, terms) |
| `components/platform/contract/` | Terms markdown, proposal cards, logo UI |
| `components/platform/invite/` | Customer invite experience + admin previews |
| `components/platform/amendment/` | Amendment accept + terms gate UI |
| `components/platform/admin/` | Account management list/detail, wizard panels + steps |

## Lambdas

| Lambda | Purpose |
|--------|---------|
| `sendTransactionalEmail` | Team invite + platform invite + amendment emails (`kind` dispatch) |
| `platformCommerce` | Stripe checkout, upgrades/downgrades, auth user creation |
| `sendFluxQuizSubmission` | Flux quiz (separate product — not platform domain) |

Client URLs: `lib/services/transactionalEmail.ts`, `lib/services/platformCommerce.ts`

## Four wizard patterns

1. **Modal step** — Smartlead, CSV builder (`BaseModal` + `WizardStepIndicator`)
2. **Full-page step** — Platform admin invite/amendment (`WizardPageShell`)
3. **Route-stack** — Foundry import (`ImportWizardContext` + routes)
4. **Customer branded** — `PlatformInviteExperience` (no wizard chrome)

## Component dedup

| Job | Component |
|-----|-----------|
| Horizontal pick-one | `SegmentControl` |
| Vertical cards | `SelectableOptionCards` |
| Simple text field | `FormTextField` |
| Label + slot | `FormFieldGroup` |
| Toggle row | `SettingToggleRow` |
| Markdown editor | `MarkdownEditorPanel` |
| Footer | `WizardFooter` (`ModalFooter` re-exports) |
| Step indicator | `WizardStepIndicator` |

## Tests

```bash
npm run test:platform
```

Stripe and webhook guardrails:

- `docs/engineering/stripe-platform-billing.md`
- `docs/platform/account-amendment-billing-scenarios.md`

## Billing notes

- Invite checkout and amendment upgrades now share the same MST-based billing calendar helpers.
- Amendment upgrades use a route-aware quote model, so card fees versus ACH fees are reflected consistently in preview, charge, and next-invoice credit behavior.
- Existing-account billing-method changes use setup-mode Stripe Checkout and synchronize both customer and subscription defaults before the retry/confirm step.
- ACH amendment upgrades provision on initiation; a later ACH failure moves the account into `payment_required` recovery.

## Customer URLs (unchanged)

- `/accept-platform-invite/[id]`
- `/accept-account-amendment/[id]`

## Admin routes

- `/admin/accounts` — list
- `/admin/accounts/[id]` — detail
- `/admin/accounts/sign-new-client` — invite wizard
- `/admin/accounts/sign-account-amendment` — amendment wizard
- `/admin/invite-preview` — embedded invite preview (platform admin)

## Definition of Done (rollup)

After PR3: run greps from the restructure plan — zero old import paths, required dirs exist, wizard pages &lt;200 lines, `npm run test:platform` passes, manual wizard smoke (~30 min).
