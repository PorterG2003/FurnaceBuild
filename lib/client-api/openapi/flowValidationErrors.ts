export type FlowValidationErrorEntry = { code: string; cause: string; fix: string };

export const FLOW_VALIDATION_ERROR_CATALOG: FlowValidationErrorEntry[] = [
  { code: 'invalid_nodes', cause: '`nodes` is not an array.', fix: 'Send `{ nodes: [], edges: [] }` with `nodes` as an array.' },
  { code: 'invalid_edges', cause: '`edges` is not an array.', fix: 'Send `edges` as an array (empty array is valid).' },
  { code: 'too_many_nodes', cause: 'More than 100 nodes.', fix: 'Split into multiple campaigns or simplify the graph.' },
  { code: 'too_many_edges', cause: 'More than 200 edges.', fix: 'Reduce edge count.' },
  { code: 'missing_node_id', cause: 'A node has no `id`.', fix: 'Assign a stable string id to every node.' },
  { code: 'duplicate_node_id', cause: 'Two nodes share the same `id`.', fix: 'Use unique ids across all nodes.' },
  { code: 'invalid_node_type', cause: 'Unsupported `type` value.', fix: 'Use `leadSource`, `email`, `waitTime`, `aiCategorizer`, or `dataSender`.' },
  { code: 'invalid_lead_source_count', cause: 'Not exactly one `leadSource` node.', fix: 'Include exactly one `leadSource` node.' },
  { code: 'too_many_categorizers', cause: 'More than one `aiCategorizer` node.', fix: 'Use at most one categorizer per flow.' },
  { code: 'invalid_custom_field_key', cause: 'Custom field key is empty or contains `{`/`}`.', fix: 'Trim keys; avoid braces (they break `{{custom.<key>}}` tokens).' },
  { code: 'invalid_standard_field_key', cause: '`mappedStandardFieldKeys` entry is not a known standard field.', fix: 'Use keys like `email`, `first_name`, `last_name`, `company_name`, `website`, `linkedin_url`, `company_linkedin_url`, `source`.' },
  { code: 'missing_variants', cause: 'Email node has no variants.', fix: 'Add at least one variant to every email node.' },
  { code: 'too_many_variants', cause: 'Email node has more than 20 variants.', fix: 'Reduce variant count to 20 or fewer.' },
  { code: 'invalid_variant_id', cause: 'Variant `id` is missing or not a UUID.', fix: 'Assign a stable UUID to each variant before first save; never change ids on live campaigns.' },
  { code: 'invalid_variant_subject', cause: 'Variant `subject` is not a string.', fix: 'Set `subject` to a string (empty string is allowed for reply-mode emails).' },
  { code: 'invalid_variant_template', cause: 'Variant `template` is not a string.', fix: 'Set `template` to a string body.' },
  { code: 'variant_content_too_large', cause: 'Subject or template exceeds 100,000 characters.', fix: 'Shorten copy.' },
  { code: 'no_active_variants', cause: 'All variants have `isActive: false`.', fix: 'Keep at least one active variant per email node.' },
  { code: 'invalid_send_mode', cause: '`send_mode` is not `new` or `reply`.', fix: 'Use `new` for sequence emails; `reply` for categorizer follow-ups in the same thread.' },
  { code: 'malformed_merge_variable', cause: 'Unclosed or invalid `{{...}}` syntax in copy.', fix: 'Fix merge-token syntax; use `{{first_name}}` or `{{custom.company}}`.' },
  { code: 'unknown_merge_variable', cause: 'Merge variable not declared on the lead source.', fix: 'Add the key to `customFieldKeys` or `mappedStandardFieldKeys`, or remove the token from copy.' },
  { code: 'invalid_wait_duration', cause: '`wait_duration_seconds` is missing, zero, or not a positive number.', fix: 'Set a positive integer in seconds (e.g. `86400` for one day).' },
  { code: 'missing_edge_id', cause: 'An edge has no `id`.', fix: 'Assign a stable string id to every edge.' },
  { code: 'duplicate_edge_id', cause: 'Two edges share the same `id`.', fix: 'Use unique edge ids.' },
  { code: 'unknown_edge_source', cause: 'Edge `source` does not match a node id.', fix: 'Point `source` at an existing node `id`.' },
  { code: 'unknown_edge_target', cause: 'Edge `target` does not match a node id.', fix: 'Point `target` at an existing node `id`.' },
  { code: 'self_referential_edge', cause: 'Edge source and target are the same node.', fix: 'Remove self-loops.' },
  { code: 'invalid_categorizer_source_handle', cause: 'Categorizer edge missing or invalid `sourceHandle`.', fix: 'Use `interested`, `neutral`, or `not-interested`.' },
  { code: 'duplicate_categorizer_branch', cause: 'Same categorizer branch handle used twice.', fix: 'Wire each branch handle at most once per categorizer node.' },
  { code: 'unreachable_node', cause: 'Node is not reachable from the lead source.', fix: 'Connect every node into the graph starting from `leadSource`.' },
  { code: 'cycle_detected', cause: 'Graph contains a cycle.', fix: 'Remove loops; flows must be directed acyclic graphs.' },
];

export function buildFlowValidationErrorCatalogMarkdown(): string {
  const rows = FLOW_VALIDATION_ERROR_CATALOG.map(
    (entry) => `| \`${entry.code}\` | ${entry.cause} | ${entry.fix} |`,
  );
  return [
    'During **draft** flow saves, every code below is returned in `validation.warnings` and the save still persists.',
    'During **launch** (or validate with `phase: launch`), the same codes appear in `blocking_issues` and block go-live.',
    '',
    '| Code | Cause | Fix |',
    '| --- | --- | --- |',
    ...rows,
  ].join('\n');
}
