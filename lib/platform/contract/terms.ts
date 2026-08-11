import type { PlatformInviteProrationMode } from '@/lib/billing/proration';

export type AgreementType = 'platform_agreement' | 'managed_services_agreement';

type AgreementTemplateDefinition = {
  type: AgreementType;
  label: string;
  title: string;
  version: string;
  markdown: string;
};

export const AGREEMENT_TYPE_OPTIONS: AgreementTemplateDefinition[] = [
  {
    type: 'platform_agreement',
    label: 'Platform Agreement',
    title: 'Platform Agreement',
    version: 'platform-agreement-current',
    markdown: `# Furnace Platform Agreement

Last updated: June 1, 2025

By creating an account, accessing Furnace, or using the platform in any way, you agree to this Platform Agreement. If you do not agree, do not use Furnace.

## 1. Platform overview

Furnace provides a software platform for running cold email outreach campaigns. The platform lets you manage contact lists, build and send sequences, monitor campaign performance, and use related outreach tools. You are responsible for the campaigns you run through the platform.

## 2. Account registration and eligibility

To use Furnace, you must create an account with accurate and complete information. You represent that:

- you are at least 18 years old and have authority to enter into this agreement
- your registration information is accurate and stays up to date
- you are responsible for your account credentials and all activity under your account
- you will promptly notify Furnace of any unauthorized account access

## 3. Subscription and payment

### 3.1 Monthly subscription

Platform access is billed monthly. Your first invoice is due when the account is activated. Ongoing invoices are issued on the 1st of each calendar month, or the next business day when needed.

### 3.2 Prorated billing

If your account activates mid-month, your second invoice will be prorated to cover the remainder of that calendar month. Standard monthly billing begins the following month.

### 3.3 Late payments

Invoices are due upon receipt. Payments more than ten (10) days late incur a $20 late fee. Furnace may suspend platform access for overdue accounts.

## 4. Acceptable use

You agree to use Furnace only for lawful outreach purposes. You may not:

- upload or use contact data obtained unlawfully or in violation of third-party rights
- use the platform in ways that violate the rights, privacy, or dignity of any person
- reverse engineer, copy, or extract Furnace systems, algorithms, or methodologies
- interfere with the platform's infrastructure or security
- misrepresent your identity or affiliation in outreach sent through the platform

## 5. Compliance

### 5.1 Your responsibility

You are solely responsible for ensuring that your use of Furnace, including contact data, email content, and targeting decisions, complies with all applicable laws and regulations, including CAN-SPAM, CASL, GDPR, and other applicable privacy or anti-spam laws.

### 5.2 Furnace guidance

Furnace may provide compliance guidance, best practices, or platform safeguards to help you send responsibly. That guidance is not legal advice and does not shift compliance responsibility to Furnace. You are responsible for obtaining your own legal advice when needed.

### 5.3 Data sourcing

You represent and warrant that all prospect data uploaded to the platform was obtained lawfully and with all required permissions. Furnace is not responsible for the origin or legality of data you supply.

## 6. Data ownership and privacy

### 6.1 Your data

You retain ownership of all prospect data, contact lists, and related information you provide to or import into Furnace ("Client Data"). Furnace will not sell or disclose Client Data in any way that could reasonably identify you or your prospect relationships.

### 6.2 Platform license

You grant Furnace a perpetual, irrevocable, royalty-free license to store and use Client Data in transformed form solely for internal purposes, including platform operation, maintenance, improvement, and AI or machine-learning model training. This license survives termination.

### 6.3 Campaign performance data

Campaign performance data generated through your use of the platform, including open rates, reply rates, sequence performance, and deliverability metrics, is owned by you. Furnace may retain anonymized, non-attributable derivatives for internal platform improvement.

### 6.4 Aggregate use

Furnace may use anonymized, aggregated insights from campaign data for benchmarks, product development, and published statistics, provided that use cannot reasonably identify you, your prospects, or your campaign strategies.

### 6.5 Furnace-supplied data

If Furnace makes prospect lists or contact data available through the platform ("Furnace Data"), that data remains Furnace property. You receive a limited, non-exclusive, non-transferable license to use Furnace Data for legitimate business purposes. Leads or qualified prospects generated from Furnace Data are owned by you, but the underlying Furnace Data is not transferred.

## 7. Intellectual property

Furnace retains exclusive ownership of the platform and all associated technology, including outreach systems, automation tools, infrastructure, algorithms, and proprietary methodologies. This agreement gives you only the limited right to use Furnace as described here.

Email templates you create remain yours and may be used after termination. You may not replicate or use Furnace systems or processes outside the platform.

## 8. Term and termination

This agreement starts when you create your account and continues month to month unless terminated. Either party may terminate with fourteen (14) days' written notice. Either party may terminate immediately for a material breach by the other party.

When this agreement ends, platform access ends at the close of the current billing period, or immediately in the event of material breach. You may export Client Data and leads generated during your engagement before termination.

## 9. Confidentiality

Both parties will keep confidential any proprietary information exchanged under this agreement during the term and for one (1) year after termination. Furnace will not share your strategies, campaign data, or client-specific insights with other users.

## 10. Indemnification

You agree to indemnify, defend, and hold harmless Furnace and its officers, employees, and agents from claims, losses, liabilities, and expenses arising from your use of the platform, including claims related to your outreach campaigns, data practices, or compliance failures. Furnace will indemnify you for claims arising from Furnace's gross negligence or willful misconduct.

## 11. Disclaimer of warranties

The platform is provided "as is" and "as available" without warranties of any kind, express or implied. Furnace does not warrant that the platform will be uninterrupted, error-free, or free of harmful components.

## 12. Limitation of liability

To the maximum extent permitted by law, Furnace is not liable for indirect, incidental, special, consequential, or punitive damages arising from your use of the platform. Furnace's total liability will not exceed the amounts you paid Furnace in the three (3) months before the claim.

## 13. Changes to this agreement

Furnace may update this agreement from time to time. Material changes will be shared by email or in-product notice. Continued use of the platform after the effective date of an update means you accept the revised agreement.

## 14. Governing law

This agreement is governed by the laws of the State of Utah, without regard to conflict-of-law rules. The parties consent to exclusive jurisdiction and venue in the state and federal courts located in Utah.

## 15. Entire agreement

This agreement is the entire understanding between you and Furnace regarding the platform and supersedes prior agreements or understandings on that subject.
`,
  },
  {
    type: 'managed_services_agreement',
    label: 'Managed Services Agreement',
    title: 'Managed Services Agreement',
    version: 'managed-services-agreement-current',
    markdown: `# Furnace Managed Services Agreement

Last updated: June 1, 2025

This Managed Services Agreement covers Furnace's done-for-you cold email outreach services for {{client_name}}. The effective date and service start date are {{effective_date_mst}}.

By accepting this invite and completing payment, Client agrees to this Managed Services Agreement.

## 1. Scope of services

Furnace will provide fully managed cold email outreach services on Client's behalf, which may include:

- developing and executing personalized outreach campaigns
- managing sending, deliverability, inbox workflows, and performance optimization
- providing platform access for visibility and reporting
- sourcing prospect lists and contact data where applicable

The current managed-services scope is:

- outreach volume: {{outreach_volume}} emails per month
- sending inboxes: {{inbox_count}}
- service start date: {{start_date_mst}}

## 2. Compensation and payment

### 2.1 Fees

Client agrees to pay Furnace a monthly retainer of {{monthly_fee}} for the duration of this agreement.

### 2.2 Invoicing

The initial invoice of {{monthly_fee}} is due when this agreement is accepted. Subsequent invoices are issued on the 1st of each calendar month, or the next business day when needed. If a billing period begins mid-month, the second invoice is prorated accordingly.

### 2.3 Late payments

Invoices are due upon receipt. Payments more than ten (10) days late incur a $20 late fee. Furnace may pause or suspend services for overdue accounts.

## 3. Compliance

### 3.1 Furnace compliance responsibility

Furnace assumes responsibility for compliance with applicable email sending laws and regulations, including CAN-SPAM and CASL, for outreach campaigns Furnace runs on Client's behalf. That includes opt-out handling, sender identification requirements, and applicable sending restrictions.

### 3.2 Client-supplied data

If Client supplies prospect lists or contact data, Client represents and warrants that the data was obtained lawfully and in compliance with applicable law. Furnace's compliance obligations apply to Furnace's use of that data, not to its original sourcing or acquisition by Client.

### 3.3 Client account actions

Client may access and make changes to campaigns, sequences, contacts, and settings through the Furnace account at any time. Furnace is not responsible for actions Client takes directly in the account, including campaign edits, contact-list changes, or sending-setting adjustments. Client is responsible for the consequences of those direct actions.

## 4. Data ownership and privacy

### 4.1 Client data

Client retains ownership of all prospect data, contact lists, and related information provided to or imported into Furnace ("Client Data"). Furnace will not sell or disclose Client Data in any way that could reasonably identify Client or Client's prospect relationships.

### 4.2 Platform license

Client grants Furnace a perpetual, irrevocable, royalty-free license to store and use Client Data in transformed form solely for internal purposes, including platform operation, maintenance, improvement, and AI or machine-learning model training. This license survives termination.

### 4.3 Campaign performance data

Campaign performance data generated during the engagement, including open rates, reply rates, sequence performance, and deliverability metrics, is owned by Client. Furnace may retain anonymized, non-attributable derivatives for internal improvement.

### 4.4 Aggregate use

Furnace may use anonymized, aggregated insights from campaign data for benchmarks, product development, and published statistics, provided that use cannot reasonably identify Client, Client's prospects, or Client's campaign strategies.

### 4.5 Furnace-supplied data

If Furnace sources prospect lists or contact data as part of the engagement ("Furnace Data"), that data remains Furnace property. Client receives a limited, non-exclusive, non-transferable license to use Furnace Data for legitimate business purposes. Qualified leads or SQLs generated from Furnace Data are owned by Client, but the underlying Furnace Data is not transferred.

## 5. Intellectual property

Furnace retains exclusive ownership of all outreach systems, automation tools, platform infrastructure, algorithms, sending systems, and proprietary methodologies used to deliver the services.

Client may continue using email templates developed during the engagement after termination. Client may not replicate or use Furnace outreach systems or processes outside the platform.

## 6. Performance and reporting

Client will have access to the Furnace platform throughout the engagement, including visibility into outreach performance, response tracking, and lead activity. Furnace does not guarantee response rates, lead quality, or business outcomes. Results vary based on industry, targeting, market conditions, and other factors outside Furnace's control.

## 7. Term and termination

This agreement begins on {{effective_date_mst}} and continues month to month unless terminated. Either party may terminate with fourteen (14) days' written notice. Either party may terminate immediately for a material breach by the other party.

When this agreement ends, Furnace will stop outreach activity on Client's behalf. Client may export Client Data and leads generated during the engagement. Any license to Furnace Data ends on the termination date.

## 8. Confidentiality

Both parties will keep confidential any proprietary information exchanged during the term and for one (1) year after termination. Furnace will not share Client strategies, campaign data, or engagement-specific insights with other clients.

## 9. Indemnification

Each party will indemnify, defend, and hold harmless the other from claims, losses, liabilities, and expenses arising from that party's own actions or obligations under this agreement, except in cases of gross negligence or willful misconduct by the indemnified party. Client's indemnification obligations include claims arising from Client's direct actions inside the Furnace account.

## 10. Disclaimer of warranties

The services and platform are provided "as is" without warranties of any kind, express or implied. Furnace does not warrant that the services will be uninterrupted, error-free, or produce any specific outcome.

## 11. Limitation of liability

To the maximum extent permitted by law, Furnace is not liable for indirect, incidental, special, consequential, or punitive damages arising out of this agreement. Furnace's total liability will not exceed the fees paid by Client in the three (3) months before the claim.

## 12. Governing law

This agreement is governed by the laws of the State of Utah, without regard to conflict-of-law rules. The parties consent to exclusive jurisdiction and venue in the state and federal courts located in Utah.

## 13. Entire agreement

This agreement is the entire understanding between the parties regarding the managed-services engagement and supersedes prior agreements or understandings on that subject.
`,
  },
];

const AGREEMENT_TYPE_LOOKUP = new Map(
  AGREEMENT_TYPE_OPTIONS.map((option) => [option.type, option] as const)
);

const DEFAULT_PLACEHOLDER_FALLBACKS = {
  client_name: 'Client',
  monthly_fee: '$0',
  effective_date_mst: '',
  start_date_mst: '',
  outreach_volume: 'TBD',
  inbox_count: 'TBD',
} satisfies Record<string, string>;

const MST_TIMEZONE = 'Etc/GMT+7';

function formatWholeUsd(cents?: number | null) {
  if (typeof cents !== 'number' || Number.isNaN(cents)) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatWholeNumber(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

function readPositiveNumber(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function formatCurrentMstDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: MST_TIMEZONE,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function normalizeAgreementType(value: unknown): AgreementType {
  return value === 'managed_services_agreement' ? 'managed_services_agreement' : 'platform_agreement';
}

/**
 * Stock proration clauses, keyed by mode. The agreement text is snapshotted at publish, so
 * it has to state the billing behavior the invite was actually configured with.
 */
const PRORATION_CLAUSES: {
  second_month: string;
  first_month: string;
}[] = [
  {
    second_month:
      'If your account activates mid-month, your second invoice will be prorated to cover the remainder of that calendar month. Standard monthly billing begins the following month.',
    first_month:
      'If your account activates mid-month, your first invoice is prorated to cover the remainder of that calendar month. Standard monthly billing begins on the 1st of the following month.',
  },
  {
    second_month:
      'The initial invoice of {{monthly_fee}} is due when this agreement is accepted. Subsequent invoices are issued on the 1st of each calendar month, or the next business day when needed. If a billing period begins mid-month, the second invoice is prorated accordingly.',
    first_month:
      'The initial invoice is due when this agreement is accepted, prorated to cover the remainder of the current calendar month. Subsequent invoices of {{monthly_fee}} are issued on the 1st of each calendar month, or the next business day when needed.',
  },
];

export interface ProrationClauseSwapResult {
  markdown: string;
  /** False when no stock clause matched, meaning the agreement was hand-edited. */
  applied: boolean;
}

/**
 * Rewrites the stock proration clause to match the selected mode. Only exact stock sentences
 * are replaced, so a hand-edited agreement is left untouched and the caller can warn instead.
 */
export function applyProrationModeToTermsMarkdown(
  markdown: string,
  prorationMode: PlatformInviteProrationMode,
): ProrationClauseSwapResult {
  const otherMode: PlatformInviteProrationMode =
    prorationMode === 'first_month' ? 'second_month' : 'first_month';

  let next = markdown;
  let applied = false;

  for (const clause of PRORATION_CLAUSES) {
    const target = clause[prorationMode];
    if (next.includes(target)) {
      applied = true;
      continue;
    }
    const source = clause[otherMode];
    if (next.includes(source)) {
      next = next.replace(source, target);
      applied = true;
    }
  }

  return { markdown: next, applied };
}

export function getAgreementTypeDefinition(agreementType: AgreementType) {
  return AGREEMENT_TYPE_LOOKUP.get(agreementType) ?? AGREEMENT_TYPE_OPTIONS[0];
}

export function getAgreementTypeLabel(agreementType: AgreementType) {
  return getAgreementTypeDefinition(agreementType).label;
}

export function getAgreementTypeTitle(agreementType: AgreementType) {
  return getAgreementTypeDefinition(agreementType).title;
}

export function getAgreementTypeVersion(agreementType: AgreementType) {
  return getAgreementTypeDefinition(agreementType).version;
}

export function getAgreementTemplateMarkdown(agreementType: AgreementType) {
  return getAgreementTypeDefinition(agreementType).markdown;
}

export function buildTermsVariableMap(params: {
  proposedAccountName?: string | null;
  monthlyRetainerCents?: number | null;
  proposalSnapshot?: Record<string, unknown> | null;
  now?: Date;
}) {
  const proposal = params.proposalSnapshot ?? {};
  const mstDate = formatCurrentMstDate(params.now);
  const clientName =
    typeof params.proposedAccountName === 'string' && params.proposedAccountName.trim()
      ? params.proposedAccountName.trim()
      : DEFAULT_PLACEHOLDER_FALLBACKS.client_name;

  return {
    client_name: clientName,
    monthly_fee: formatWholeUsd(params.monthlyRetainerCents),
    effective_date_mst: mstDate,
    start_date_mst: mstDate,
    outreach_volume:
      formatWholeNumber(readPositiveNumber(proposal, 'managed_outreach_volume')) ??
      DEFAULT_PLACEHOLDER_FALLBACKS.outreach_volume,
    inbox_count:
      formatWholeNumber(readPositiveNumber(proposal, 'managed_inbox_count')) ??
      DEFAULT_PLACEHOLDER_FALLBACKS.inbox_count,
  };
}

export function renderTermsTemplate(markdown: string, variableMap: Record<string, string>) {
  return markdown.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, key: string) => {
    const normalizedKey = key.toLowerCase();
    return variableMap[normalizedKey] ?? match;
  });
}

export function renderPlatformTermsMarkdown(params: {
  sourceMarkdown: string;
  proposedAccountName?: string | null;
  monthlyRetainerCents?: number | null;
  proposalSnapshot?: Record<string, unknown> | null;
  now?: Date;
}) {
  return renderTermsTemplate(
    params.sourceMarkdown,
    buildTermsVariableMap({
      proposedAccountName: params.proposedAccountName,
      monthlyRetainerCents: params.monthlyRetainerCents,
      proposalSnapshot: params.proposalSnapshot,
      now: params.now,
    })
  );
}
