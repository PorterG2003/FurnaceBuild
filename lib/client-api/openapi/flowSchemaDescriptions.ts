import type { DocLinkMode } from './docLinks.js';
import { guideLink, modelLink } from './docLinks.js';

export function buildFlowNormalizationMarkdown(): string {
  return [
    'Every flow save and validate runs normalization before validation:',
    '',
    '| What | Behavior |',
    '| --- | --- |',
    '| UI-only fields | Strips `selected`, `dragging`, `measured`, `positionAbsolute`, `resizing` from nodes; `selected` from edges. |',
    '| Lead source | Forces `deletable: false`. Trims and deduplicates `customFieldKeys`. |',
    '| Email variants | Assigns UUID `id` if missing; re-labels `A`/`B`/…; re-orders; canonicalizes HTML; migrates legacy single-variant shape. |',
    '| Wait nodes | Derives `wait_duration_seconds` from `duration` + `unit` when seconds absent; back-fills display `duration`/`unit` from seconds. |',
    '| Categorizer edges | Backfills `sourceHandle` on categorizer outgoing edges when missing. |',
    '| Data sender | Merges `endpoint`/`endpoint_url`; serializes `payload_template` to `payload` when needed. |',
    '',
    'API responses and `normalized_flow` in validate results always reflect the canonical stored shape.',
  ].join('\n');
}

export function buildFlowMergeVariablesMarkdown(linkMode: DocLinkMode = 'docs'): string {
  return [
    'Use `{{token}}` syntax in email subjects, templates, `body_html`, and dataSender payloads.',
    '',
    '| Token pattern | Source | Example |',
    '| --- | --- | --- |',
    '| `{{email}}`, `{{first_name}}`, … | `mappedStandardFieldKeys` on lead source (all standard fields when unset) | `{{first_name}}` |',
    '| `{{custom.<key>}}` | `customFieldKeys` on lead source | `{{custom.company}}` |',
    '',
    'Rules:',
    '',
    '- Tokens must be well-formed `{{key}}` or `{{custom.key}}` — malformed syntax returns `malformed_merge_variable`.',
    '- Unknown tokens return `unknown_merge_variable`. Declare the key on the lead source, or remove the token from copy.',
    '- Draft flow saves persist with validation warnings; launch readiness uses `phase: launch` and blocks on these codes.',
    '- Custom field keys must not contain `{` or `}` characters.',
    '',
    `See ${modelLink('LeadSourceNodeData', linkMode)} for field declarations and ${modelLink('EmailVariant', linkMode)} for copy fields.`,
  ].join('\n');
}

export function buildCampaignFlowDescription(linkMode: DocLinkMode = 'docs'): string {
  return [
    'Directed acyclic graph of campaign steps (`nodes` + `edges`).',
    `See ${guideLink('Email sequences', '/concepts/sequences/', linkMode)} for a plain-language overview, or expand the properties below.`,
  ].join(' ');
}

export function buildFlowUpdateDescription(linkMode: DocLinkMode = 'docs'): string {
  return [
    'Canonical campaign flow payload for `POST /v1/campaigns/{id}/flow`, `PUT .../flow` (deprecated), and `POST .../flow:validate`.',
    '',
    `Same shape as ${modelLink('CampaignFlow', linkMode)}. See ${guideLink('Campaign setup', '/guides/campaign-setup/', linkMode)} and ${guideLink('Email sequences', '/concepts/sequences/', linkMode)}.`,
  ].join('\n');
}

export function buildFlowValidationIssueDescription(linkMode: DocLinkMode = 'docs'): string {
  return [
    'One validation problem in `issues[]` from flow validate/save, or in `details[]` on `400 invalid_flow` errors.',
    '',
    'Each issue has a `path`, a `code`, and a human-readable `message` describing what to fix.',
  ].join('\n');
}

export function buildFlowValidateResultDescription(linkMode: DocLinkMode = 'docs'): string {
  return [
    'Dry-run result from `POST /v1/campaigns/{id}/flow:validate`. Shows normalized flow, validation issues, change classification, and lifecycle gate outcome.',
    '',
    `See ${modelLink('FlowValidationIssue', linkMode)}.`,
  ].join('\n');
}

export const LEAD_SOURCE_STANDARD_FIELD_KEYS =
  '`email`, `name`, `first_name`, `last_name`, `company_name`, `website`, `linkedin_url`, `company_linkedin_url`, `source`';

export function buildLeadSourceNodeDataDescription(linkMode: DocLinkMode = 'docs'): string {
  return [
    'Configuration for the single required `leadSource` node. Declares merge variables and custom lead fields.',
    '',
    `Allowed standard keys for mappedStandardFieldKeys: ${LEAD_SOURCE_STANDARD_FIELD_KEYS}.`,
    '',
    `Details: ${guideLink('Email sequences', '/concepts/sequences/', linkMode)}.`,
  ].join('\n');
}

export function buildEmailVariantDescription(linkMode: DocLinkMode = 'docs'): string {
  return [
    'One A/B variant of an email node. Variant ids must be stable UUIDs. Supports merge variables in `subject`, `template`, and `body_html`.',
    '',
    'Empty `subject` reuses the first outbound subject and continues the thread.',
    '',
    `See ${guideLink('Email sequences', '/concepts/sequences/', linkMode)}.`,
  ].join('\n');
}

export function buildEmailNodeDataDescription(linkMode: DocLinkMode = 'docs'): string {
  return [
    'Outbound email node with one or more A/B variants.',
    '',
    `\`priority\`: derived boolean (not user-set). True when the email is downstream of a categorizer and sends on the immediate/priority lane. See ${modelLink('EmailVariant', linkMode)} for copy fields.`,
  ].join('\n');
}

export function buildWaitTimeNodeDataDescription(): string {
  return [
    'Delay node. `wait_duration_seconds` is the runtime source of truth; `duration` and `unit` are display fields derived on save.',
  ].join('\n');
}
