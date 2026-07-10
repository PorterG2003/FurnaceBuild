import { modelLink } from './docLinks.js';
import { buildFlowValidationErrorCatalogMarkdown } from './flowValidationErrors.js';

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

export function buildFlowMergeVariablesMarkdown(): string {
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
    `See ${modelLink('LeadSourceNodeData')} for field declarations and ${modelLink('EmailVariant')} for copy fields.`,
  ].join('\n');
}

export function buildCampaignFlowDescription(): string {
  return [
    'Directed acyclic graph (DAG) defining the campaign sequence. Consumed by flow save, validate, and optional `flow` on campaign create.',
    '',
    '```mermaid',
    'flowchart LR',
    '  leadSource --> email1[email]',
    '  email1 --> wait[waitTime]',
    '  wait --> email2[email]',
    '  email2 --> cat[aiCategorizer]',
    '  cat -->|"interested"| reply[email reply]',
    '  cat -->|"not-interested"| breakup[email]',
    '```',
    '',
    '**Structure**',
    '',
    `- ${modelLink('FlowNode')} — one step per node; \`data\` shape depends on \`type\``,
    `- ${modelLink('FlowEdge')} — directed connections between nodes`,
    '',
    '**Node types** (see `FlowNode.data`):',
    '',
    `- \`leadSource\` — ${modelLink('LeadSourceNodeData')} (exactly one per flow)`,
    `- \`email\` — ${modelLink('EmailNodeData')} with ${modelLink('EmailVariant')} variants`,
    `- \`waitTime\` — ${modelLink('WaitTimeNodeData')}`,
    `- \`aiCategorizer\` — ${modelLink('AICategorizerNodeData')} (at most one per flow)`,
    `- \`dataSender\` — ${modelLink('DataSenderNodeData')}`,
    '',
    '**Merge variables**',
    '',
    buildFlowMergeVariablesMarkdown(),
    '',
    '**Validation rules**',
    '',
    '- Exactly one `leadSource` node',
    '- At most one `aiCategorizer` node',
    '- Maximum 100 nodes, 200 edges',
    '- No cycles — flows must be DAGs',
    '- Every node reachable from `leadSource`',
    '- Unique node and edge ids',
    '',
    `For normalization behavior see ${modelLink('FlowUpdate')}. For validation error codes see ${modelLink('FlowValidationIssue')}. For lifecycle rules see Guide → Building campaigns.`,
  ].join('\n');
}

export function buildFlowUpdateDescription(): string {
  return [
    'Canonical campaign flow payload for `POST /v1/campaigns/{id}/flow`, `PUT .../flow`, and `POST .../flow:validate`.',
    '',
    `Same shape as ${modelLink('CampaignFlow')}. See Guide → Building campaigns for lifecycle rules, curl examples, and draft-vs-live locking.`,
    '',
    '**Normalization on save**',
    '',
    buildFlowNormalizationMarkdown(),
  ].join('\n');
}

export function buildFlowValidationIssueDescription(): string {
  return [
    'One validation problem returned in `issues[]` from flow validate/save, or in `details[]` on `400 invalid_flow` errors.',
    '',
    '**Error-code catalog**',
    '',
    buildFlowValidationErrorCatalogMarkdown(),
  ].join('\n');
}

export function buildFlowValidateResultDescription(): string {
  return [
    'Dry-run result from `POST /v1/campaigns/{id}/flow:validate`. Shows normalized flow, validation issues, change classification, and lifecycle gate outcome.',
    '',
    '**Validation failure (`400`)** returns `invalid_flow` with a `details[]` array of issue objects (same shape as `issues[]` here):',
    '',
    '```json',
    JSON.stringify(
      {
        error: {
          type: 'invalid_request_error',
          code: 'invalid_flow',
          message: 'Flow validation failed',
        },
        details: [
          {
            path: 'nodes[1].data.variants[0].id',
            code: 'invalid_variant_id',
            message: 'Email variants must have a stable UUID id.',
          },
        ],
      },
      null,
      2,
    ),
    '```',
    '',
    '**Lifecycle block (`403`)** when structural edits are blocked on live campaigns:',
    '',
    '```json',
    JSON.stringify(
      {
        error: {
          type: 'permission_error',
          code: 'flow_locked',
          message:
            'This campaign is no longer a draft, so structural flow changes are locked. You can still edit copy, variants, timing, and node configuration.',
        },
      },
      null,
      2,
    ),
    '```',
    '',
    `See ${modelLink('FlowValidationIssue')} for the full error-code catalog.`,
  ].join('\n');
}

export const LEAD_SOURCE_STANDARD_FIELD_KEYS =
  '`email`, `name`, `first_name`, `last_name`, `company_name`, `website`, `linkedin_url`, `company_linkedin_url`, `source`';

export function buildLeadSourceNodeDataDescription(): string {
  return [
    'Configuration for the single required `leadSource` node. Declares which merge variables and custom lead fields the campaign requires.',
    '',
    `Allowed standard keys for ${'`mappedStandardFieldKeys`'}: ${LEAD_SOURCE_STANDARD_FIELD_KEYS}. When omitted, all standard fields are allowed as merge variables.`,
  ].join('\n');
}

export function buildEmailVariantDescription(): string {
  return [
    'One A/B variant of an email node. Variant ids must be stable UUIDs — they tie stats and message jobs to copy. Never remove or replace ids on live campaigns.',
    '',
    'Supports merge variables in `subject`, `template`, and `body_html`. Empty `subject` is allowed for reply-mode emails (`send_mode: reply`).',
  ].join('\n');
}

export function buildEmailNodeDataDescription(): string {
  return [
    'Outbound email node with one or more A/B variants.',
    '',
    `\`send_mode\`: \`new\` for sequence emails; \`reply\` for in-thread follow-ups after categorizer. See ${modelLink('EmailVariant')} for copy fields.`,
  ].join('\n');
}

export function buildWaitTimeNodeDataDescription(): string {
  return [
    'Delay node. `wait_duration_seconds` is the runtime source of truth; `duration` and `unit` are display fields derived on save.',
    '',
    'You may send `duration` + `unit` instead of `wait_duration_seconds`; Furnace computes seconds on normalize. Example: `{ "duration": "1", "unit": "days" }` → `86400`.',
  ].join('\n');
}
