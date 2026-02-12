/**
 * Inspect campaign nodes and message_jobs for a given campaign ID to debug
 * "subject sent but not body" issues. The builder saves email body as "template"
 * in node_data; the send-worker reads "body". This script shows what's in the DB.
 *
 * Usage:
 *   CAMPAIGN_ID=6ddfc4fc-8d40-4f6f-a960-8ea31bb38a65 npx tsx scripts/inspect-campaign-message-data.ts
 *
 * Or run the SQL below in Supabase SQL Editor.
 */

const CAMPAIGN_ID = process.env.CAMPAIGN_ID || '6ddfc4fc-8d40-4f6f-a960-8ea31bb38a65';

const SQL = `
-- Campaign nodes: check node_data keys (subject vs body vs template)
SELECT id, flow_node_id, node_type,
  node_data ? 'subject' AS has_subject,
  node_data ? 'body'   AS has_body,
  node_data ? 'template' AS has_template,
  jsonb_pretty(node_data) AS node_data_pretty
FROM nodes
WHERE campaign_id = '${CAMPAIGN_ID}'
  AND node_type = 'email';

-- Message jobs for this campaign: what was stored in message_data.node_config
SELECT mj.id, mj.status, mj.sent_at,
  mj.message_data->'node_config' ? 'subject'  AS nc_has_subject,
  mj.message_data->'node_config' ? 'body'    AS nc_has_body,
  mj.message_data->'node_config' ? 'template' AS nc_has_template,
  length(mj.message_data->'node_config'->>'body')     AS body_len,
  length(mj.message_data->'node_config'->>'template') AS template_len
FROM message_jobs mj
WHERE mj.campaign_id = '${CAMPAIGN_ID}'
ORDER BY mj.created_at DESC
LIMIT 20;
`;

async function main() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    console.log('Env EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY not set.');
    console.log('Run the following SQL in Supabase SQL Editor:\n');
    console.log(SQL);
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  console.log('Campaign ID:', CAMPAIGN_ID);
  console.log('');

  const { data: nodes, error: nodesErr } = await supabase
    .from('nodes')
    .select('id, flow_node_id, node_type, node_data')
    .eq('campaign_id', CAMPAIGN_ID)
    .eq('node_type', 'email');

  if (nodesErr) {
    console.error('Nodes error:', nodesErr.message);
    return;
  }
  console.log('Email nodes:', nodes?.length ?? 0);
  for (const n of nodes || []) {
    const d = n.node_data as Record<string, unknown>;
    console.log('  -', n.flow_node_id, {
      has_subject: 'subject' in (d || {}),
      has_body: 'body' in (d || {}),
      has_template: 'template' in (d || {}),
      subject_len: typeof d?.subject === 'string' ? d.subject.length : 0,
      body_len: typeof d?.body === 'string' ? (d.body as string).length : 0,
      template_len: typeof d?.template === 'string' ? (d.template as string).length : 0,
    });
  }

  const { data: jobs, error: jobsErr } = await supabase
    .from('message_jobs')
    .select('id, status, sent_at, message_data')
    .eq('campaign_id', CAMPAIGN_ID)
    .order('created_at', { ascending: false })
    .limit(20);

  if (jobsErr) {
    console.error('Message jobs error:', jobsErr.message);
    return;
  }
  console.log('\nMessage jobs (latest 20):', jobs?.length ?? 0);
  for (const j of jobs || []) {
    const nc = (j.message_data as Record<string, unknown>)?.node_config as Record<string, unknown> | undefined;
    console.log('  -', j.id.slice(0, 8), j.status, {
      nc_has_subject: nc && 'subject' in nc,
      nc_has_body: nc && 'body' in nc,
      nc_has_template: nc && 'template' in nc,
      nc_body_len: typeof nc?.body === 'string' ? (nc.body as string).length : 0,
      nc_template_len: typeof nc?.template === 'string' ? (nc.template as string).length : 0,
    });
  }

  console.log('\nIf node_data has "template" but not "body", and send-worker only reads "body", that explains empty body.');
}

main();
