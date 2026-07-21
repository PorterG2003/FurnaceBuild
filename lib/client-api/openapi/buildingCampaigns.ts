import {
  CAMPAIGN_FLOW_EXAMPLE_CATEGORIZER,
  CAMPAIGN_FLOW_EXAMPLE_LINEAR,
} from '../../campaigns/flow/index.js';
import type { DocLinkMode } from './docLinks.js';
import { guideLink, modelLink } from './docLinks.js';
import {
  buildCampaignFlowDescription,
  buildFlowMergeVariablesMarkdown,
  buildFlowNormalizationMarkdown,
} from './flowSchemaDescriptions.js';
import { buildFlowValidationErrorCatalogMarkdown } from './flowValidationErrors.js';

const EXAMPLE_CAMPAIGN_ID = '1d8dc901-3d2d-4d9f-9dcc-4f8b3aa1a1fb';
const EXAMPLE_MAILBOX_ID = 'c23da7b6-df4e-4d2f-b100-4bb07b7d38d7';
const EXAMPLE_TAG_ID = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';

function jsonExample(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function campaignOverviewIntro(linkMode: DocLinkMode): string {
  return [
    'A Furnace campaign is an outbound sequence for a set of leads: a **flow graph** (emails, waits, categorizer branches, webhooks), one or more **mailboxes**, an optional **schedule**, and **leads** imported before launch.',
    '',
    'Lifecycle: **draft** → `POST /launch` → **running** → `PATCH /status` for pause/resume/stop. Running allows copy/config edits but blocks structural topology changes; pause to restructure; stopped campaigns are fully locked.',
    '',
    `For field-level flow object docs see ${guideLink('Flow schemas', '/guides/flow-schemas/', linkMode)} and the API reference models (${modelLink('CampaignFlow', linkMode)}, ${modelLink('FlowUpdate', linkMode)}).`,
  ].join('\n');
}

export function buildCampaignQuickstartMarkdown(linkMode: DocLinkMode = 'openapi'): string {
  return [
    campaignOverviewIntro(linkMode),
    '',
    '## TL;DR — checklist',
    '',
    '1. `GET /v1/mailboxes` — pick real mailbox UUIDs (no default mailbox alias)',
    '2. `POST /v1/campaigns` — create draft; optional `flow`, `mailbox_ids`, `schedule`',
    '3. `POST /v1/campaigns/{id}/flow` — save flow; check `field_sync` in the response',
    '4. `POST /v1/campaigns/{id}/leads` — import leads',
    '5. `GET /v1/campaigns/{id}?include=launch_state,lead_field_state` — verify readiness',
    '6. `POST /v1/campaigns/{id}/launch` — enroll all leads and start',
    '',
    'After launch, use `PATCH /v1/campaigns/{id}/status` (not `/launch`) for pause/resume/stop.',
    '',
    '## Four phases',
    '',
    '```mermaid',
    'flowchart LR',
    '  createDraft["POST /v1/campaigns"] --> saveFlow["POST .../flow"]',
    '  saveFlow --> uploadLeads["POST .../leads"]',
    '  uploadLeads --> launch["POST .../launch"]',
    '  launch --> live["status: running"]',
    '  live --> contentEdits["PATCH .../flow/nodes content edits OK"]',
    '  live --> blocked["structural edits → flow_locked"]',
    '```',
    '',
    '| Phase | Endpoint | What happens |',
    '| --- | --- | --- |',
    '| 1. Create draft | `POST /v1/campaigns` | New campaign with `status: draft`. Optional initial flow, mailboxes, tags, schedule. |',
    '| 2. Save flow | `POST /v1/campaigns/{id}/flow` | Furnace normalizes, validates, and persists the graph. |',
    '| 3. Upload leads | `POST /v1/campaigns/{id}/leads` or `.../leads/bulk` | Upsert leads; custom fields from the flow are required in `custom_lead_data`. |',
    '| 4. Launch | `POST /v1/campaigns/{id}/launch` | Backfills enrollments, switches to `running`. |',
    '',
    'Next: ' +
      guideLink('Campaign flow', '/guides/campaign-flow/', linkMode) +
      ' (field_sync, If-Match) → ' +
      guideLink('Campaign launch', '/guides/campaign-launch/', linkMode) +
      ' (lifecycle and walkthrough).',
  ].join('\n');
}

export function buildCampaignFlowMarkdown(linkMode: DocLinkMode = 'openapi'): string {
  return [
    '## field_sync',
    '',
    'When copy references merge variables, Furnace auto-declares fields on the lead source before validate/save. Every flow save response includes:',
    '',
    '```json',
    '{ "field_sync": { "declared_custom_added": ["company"], "declared_standard_added": [] } }',
    '```',
    '',
    'The response `flow` is truth — persisted `customFieldKeys` may differ from your request body.',
    '',
    '## If-Match / conflict recovery',
    '',
    '1. `GET /v1/campaigns/{id}/flow` (or campaign detail) → read `flow_revision`',
    '2. `POST /v1/campaigns/{id}/flow` with header `If-Match: <flow_revision>`',
    '3. On `412 flow_revision_conflict`, read `current_flow_revision` from the error body, refresh your base flow, merge manually, retry',
    '',
    '## Dry-run validation',
    '',
    'Dry-run any flow payload with `POST /v1/campaigns/{id}/flow:validate` before writing. See ' +
      modelLink('FlowValidateResult', linkMode) +
      ' and ' +
      guideLink('Flow schemas', '/guides/flow-schemas/', linkMode) +
      ' for validation codes.',
    '',
    '## Example flows',
    '',
    '### Linear: email → wait → email',
    '',
    '```json',
    jsonExample(CAMPAIGN_FLOW_EXAMPLE_LINEAR),
    '```',
    '',
    '### Categorizer branch',
    '',
    '```json',
    jsonExample(CAMPAIGN_FLOW_EXAMPLE_CATEGORIZER),
    '```',
    '',
    '## Lead imports depend on flow fields',
    '',
    'When the `leadSource` node declares `customFieldKeys`, every lead create or bulk-import payload must include those keys inside `custom_lead_data`. Use `GET /v1/campaigns/{id}/lead-fields` to inspect the current requirements.',
  ].join('\n');
}

export function buildCampaignLaunchMarkdown(linkMode: DocLinkMode = 'openapi'): string {
  return [
    '## End-to-end walkthrough',
    '',
    'Replace `{base_url}` and `{api_key}` with your Client API base URL and account API key (`Authorization: Bearer f_...`).',
    '',
    '### 1. Create a draft campaign',
    '',
    '```bash',
    `curl -sS -X POST '{base_url}/v1/campaigns' \\`,
    `  -H 'Authorization: Bearer {api_key}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    '  -d \'',
    jsonExample({
      name: 'Q2 Outbound',
      sending_interval_seconds: 1800,
      mailbox_ids: [EXAMPLE_MAILBOX_ID],
      tag_ids: [EXAMPLE_TAG_ID],
    }),
    '\'',
    '```',
    '',
    '### 2. Save the flow',
    '',
    '```bash',
    `curl -sS -X POST '{base_url}/v1/campaigns/${EXAMPLE_CAMPAIGN_ID}/flow' \\`,
    `  -H 'Authorization: Bearer {api_key}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    '  -d \'',
    jsonExample(CAMPAIGN_FLOW_EXAMPLE_LINEAR),
    '\'',
    '```',
    '',
    '### 3. Upload a lead',
    '',
    '```bash',
    `curl -sS -X POST '{base_url}/v1/campaigns/${EXAMPLE_CAMPAIGN_ID}/leads' \\`,
    `  -H 'Authorization: Bearer {api_key}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    '  -d \'',
    jsonExample({
      email: 'alex@acme.com',
      first_name: 'Alex',
      last_name: 'Rivera',
      custom_lead_data: { company: 'Acme Corp' },
    }),
    '\'',
    '```',
    '',
    '### 4. Launch',
    '',
    '```bash',
    `curl -sS -X POST '{base_url}/v1/campaigns/${EXAMPLE_CAMPAIGN_ID}/launch' \\`,
    `  -H 'Authorization: Bearer {api_key}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    '  -d \'{}\'',
    '```',
    '',
    '## Lifecycle',
    '',
    '| Status | Flow topology | Copy / config edits |',
    '| --- | --- | --- |',
    '| `draft` | Fully editable (add/remove nodes, rewire edges, delete variants) | Allowed |',
    '| `running` | Structural edits return `flow_locked` — pause in the builder first | Allowed (subject, body, wait duration, add variant, toggle active, positions, lead source fields, categorizer config) |',
    '| `paused` | Fully editable (flow saves reactivate completed leads on non-categorizer nodes with a live next step) | Allowed |',
    '| `stopped` | Locked — all flow edits return `flow_locked` | Blocked |',
    '',
    'Flow saves return `reactivated_count` when completed enrollments are parked on a non-categorizer node that still has an outgoing edge to a node present in the flow: those enrollments are set back to `active` so they continue into the next steps after resume. Categorizer category-exit completions are not reactivated.',
    '',
    '## Draft vs live lock',
    '',
    '| Change | Draft | Running | Paused | Stopped |',
    '| --- | --- | --- | --- | --- |',
    '| Add/remove node | Allowed | Blocked (`flow_locked`) | Allowed | Blocked |',
    '| Rewire / add / remove edge | Allowed | Blocked | Allowed | Blocked |',
    '| Delete or replace variant id | Allowed | Blocked | Allowed | Blocked |',
    '| Edit subject/body/html | Allowed | Allowed | Allowed | Blocked |',
    '| Add variant / toggle active | Allowed | Allowed | Allowed | Blocked |',
    '| Edit wait duration / categorizer config / node position | Allowed | Allowed | Allowed | Blocked |',
    '| Lead source field keys / import mapping | Allowed | Allowed | Allowed | Blocked |',
    '',
    'Structural changes are detected by comparing the stored flow to your payload. When blocked, `change_kind` is `structural` and `change_reasons` includes one or more of: `node_added`, `node_removed`, `node_type_changed`, `edge_added_or_rewired`, `edge_removed_or_rewired`, `variant_removed_or_replaced`.',
    '',
    'Blocked response (`403`):',
    '',
    '```json',
    jsonExample({
      error: {
        type: 'permission_error',
        code: 'flow_locked',
        message: 'Pause the campaign to add or rearrange steps.',
      },
    }),
    '```',
    '',
    `Validation failures (\`400\`) return \`invalid_flow\` with a \`details[]\` array of \`{ path, code, message }\` objects. See ${modelLink('FlowValidationIssue', linkMode)} and ${guideLink('Flow schemas', '/guides/flow-schemas/', linkMode)} for the full error-code catalog.`,
    '',
    '## Troubleshooting',
    '',
    '| Symptom | Likely cause | Fix |',
    '| --- | --- | --- |',
    `| \`400 invalid_flow\` with \`details[]\` | Validation failed on launch-phase validate or non-draft write | Draft saves return warnings in \`validation.warnings\`; check \`launch_state.blocking_issues\` before launch; see ${guideLink('Flow schemas', '/guides/flow-schemas/', linkMode)} |`,
    '| `403 flow_locked` on `POST .../flow` | Structural edit on a running campaign, or any edit on stopped | Pause for structural changes; stopped campaigns cannot be edited |',
    '| `400` on launch | Missing name, empty flow, or no mailbox | Set name, save flow, assign `mailbox_ids` on create or `PATCH /v1/campaigns/{id}` |',
    '| Lead import missing custom field | `customFieldKeys` on lead source not satisfied | Include every key in `custom_lead_data`; check `GET .../lead-fields` |',
    '| `unknown_merge_variable` in launch readiness | Token used in email copy but not declared on lead source | Add key to `customFieldKeys` or `mappedStandardFieldKeys`, or remove token from copy |',
    '| `unreachable_node` | Orphan node not connected from lead source | Add edges so every node is reachable from `leadSource` |',
    '| `cycle_detected` | Edge creates a loop | Remove the cycle; flows must be DAGs |',
  ].join('\n');
}

export function buildFlowSchemasMarkdown(linkMode: DocLinkMode = 'openapi'): string {
  return [
    buildCampaignFlowDescription(linkMode),
    '',
    '## Normalization on save',
    '',
    buildFlowNormalizationMarkdown(),
    '',
    '## Merge variables',
    '',
    buildFlowMergeVariablesMarkdown(linkMode),
    '',
    '## Validation error codes',
    '',
    buildFlowValidationErrorCatalogMarkdown(),
    '',
    'Related guides: ' +
      guideLink('Campaign flow', '/guides/campaign-flow/', linkMode) +
      ', ' +
      guideLink('Campaign launch', '/guides/campaign-launch/', linkMode) +
      '.',
  ].join('\n');
}

/** @deprecated Use split guide builders instead. Kept for transitional tests. */
export function buildBuildingCampaignsMarkdown(linkMode: DocLinkMode = 'openapi'): string {
  return [
    buildCampaignQuickstartMarkdown(linkMode),
    '',
    buildCampaignFlowMarkdown(linkMode),
    '',
    buildCampaignLaunchMarkdown(linkMode),
  ].join('\n\n');
}

export {
  EXAMPLE_CAMPAIGN_ID,
  EXAMPLE_MAILBOX_ID,
  EXAMPLE_TAG_ID,
};
