/**
 * Trace a campaign's flow in the database to debug "first email sent, second never came".
 * Shows: campaign status, enrollments (current_node_id, next_run_at), nodes, message_jobs,
 * flow edges, and campaign_intervals to find why the second email didn't run.
 *
 * Usage:
 *   CAMPAIGN_ID=192fa894-caef-4f9d-abbd-1ea03907141c npx tsx scripts/trace-campaign-flow.ts
 */

const CAMPAIGN_ID = process.env.CAMPAIGN_ID || '192fa894-caef-4f9d-abbd-1ea03907141c';

async function main() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    process.exit(1);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  console.log('=== Campaign flow trace ===');
  console.log('Campaign ID:', CAMPAIGN_ID);
  console.log('');

  // 1. Campaign
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, status, sending_interval_seconds, flow_data, last_completed_interval_time')
    .eq('id', CAMPAIGN_ID)
    .single();

  if (campErr || !campaign) {
    console.error('Campaign not found or error:', campErr?.message || 'No data');
    return;
  }

  console.log('--- Campaign ---');
  console.log('  status:', campaign.status);
  console.log('  sending_interval_seconds:', campaign.sending_interval_seconds);
  console.log('  last_completed_interval_time:', campaign.last_completed_interval_time);
  const edges = (campaign.flow_data as any)?.edges as any[] | undefined;
  console.log('  flow_data.edges count:', edges?.length ?? 0);
  if (edges?.length) {
    console.log('  edges (source -> target):');
    edges.forEach((e: any) => console.log('   ', e.source, '->', e.target));
  }
  console.log('');

  // 2. Nodes (by flow order for context)
  const { data: nodes, error: nodesErr } = await supabase
    .from('nodes')
    .select('id, flow_node_id, node_type')
    .eq('campaign_id', CAMPAIGN_ID)
    .order('created_at', { ascending: true });

  if (nodesErr) {
    console.error('Nodes error:', nodesErr.message);
    return;
  }

  console.log('--- Nodes ---');
  const nodeById = new Map<string, { flow_node_id: string; node_type: string }>();
  (nodes || []).forEach((n: any) => {
    nodeById.set(n.id, { flow_node_id: n.flow_node_id, node_type: n.node_type });
    console.log('  ', n.id.slice(0, 8), n.flow_node_id, n.node_type);
  });
  console.log('');

  // 3. Enrollments
  const { data: enrollments, error: enrollErr } = await supabase
    .from('enrollments')
    .select('id, lead_id, current_node_id, state, next_run_at, created_at, updated_at')
    .eq('campaign_id', CAMPAIGN_ID)
    .order('created_at', { ascending: true });

  if (enrollErr) {
    console.error('Enrollments error:', enrollErr.message);
    return;
  }

  console.log('--- Enrollments ---');
  console.log('  count:', enrollments?.length ?? 0);
  const now = new Date().toISOString();
  for (const e of enrollments || []) {
    const cur = nodeById.get(e.current_node_id || '') || null;
    const nextRunReady = e.next_run_at ? e.next_run_at <= now : false;
    console.log('  enrollment', e.id.slice(0, 8), 'lead', e.lead_id?.slice(0, 8));
    console.log('    state:', e.state, '| current_node_id:', e.current_node_id?.slice(0, 8) || 'null', cur ? `(${cur.flow_node_id} ${cur.node_type})` : '');
    console.log('    next_run_at:', e.next_run_at, nextRunReady ? '(ready for claim)' : '(future)');
    console.log('    updated_at:', e.updated_at);
  }
  console.log('');

  // 4. Message jobs
  const { data: jobs, error: jobsErr } = await supabase
    .from('message_jobs')
    .select('id, enrollment_id, node_id, status, scheduled_at, sent_at, interval_id, created_at, message_type')
    .eq('campaign_id', CAMPAIGN_ID)
    .order('created_at', { ascending: true });

  if (jobsErr) {
    console.error('Message jobs error:', jobsErr.message);
    return;
  }

  console.log('--- Message jobs ---');
  console.log('  count:', jobs?.length ?? 0);
  for (const j of jobs || []) {
    const node = nodeById.get(j.node_id || '');
    console.log('  job', j.id.slice(0, 8), 'enrollment', j.enrollment_id?.slice(0, 8), 'node', j.node_id?.slice(0, 8), node ? `(${node.flow_node_id})` : '');
    console.log('    status:', j.status, '| message_type:', j.message_type ?? 'null');
    console.log('    scheduled_at:', j.scheduled_at, '| sent_at:', j.sent_at ?? 'null');
    console.log('    interval_id:', j.interval_id?.slice(0, 8) ?? 'null', '| created_at:', j.created_at);
  }
  console.log('');

  // 5. Campaign intervals (recent)
  const { data: intervals, error: intErr } = await supabase
    .from('campaign_intervals')
    .select('id, interval_time, status, locked_at, locked_by')
    .eq('campaign_id', CAMPAIGN_ID)
    .order('interval_time', { ascending: true })
    .limit(20);

  if (!intErr && intervals?.length) {
    console.log('--- Campaign intervals (first 20) ---');
    for (const i of intervals) {
      console.log('  ', i.interval_time, i.status, i.locked_at ? `locked ${i.locked_at}` : '');
    }
    console.log('');
  }

  // 6. Summary / possible causes
  console.log('--- Possible causes (second email never sent) ---');
  const running = campaign.status === 'running';
  if (!running) {
    console.log('  1. Campaign status is not "running" -> claim_enrollments_ready and claim_message_jobs_ready skip this campaign.');
  }
  const emailNodeIds = (nodes || []).filter((n: any) => n.node_type === 'email').map((n: any) => n.id);
  const firstEmailNodeId = emailNodeIds[0];
  const secondEmailNodeId = emailNodeIds[1];
  const jobsByNode = new Map<string, any[]>();
  for (const j of jobs || []) {
    const nid = j.node_id || '';
    if (!jobsByNode.has(nid)) jobsByNode.set(nid, []);
    jobsByNode.get(nid)!.push(j);
  }
  const firstJobs = firstEmailNodeId ? jobsByNode.get(firstEmailNodeId) || [] : [];
  const secondJobs = secondEmailNodeId ? jobsByNode.get(secondEmailNodeId) || [] : [];
  const firstSent = firstJobs.some((j: any) => j.status === 'sent' || j.sent_at);
  const hasEdgeToSecond = edges?.some((e: any) => {
    const fromNode = (nodes || []).find((n: any) => n.flow_node_id === e.source);
    const toNode = (nodes || []).find((n: any) => n.flow_node_id === e.target);
    return fromNode?.node_type === 'email' && toNode?.node_type === 'email';
  });

  if (enrollments?.length) {
    const e = enrollments[0];
    const atFirstEmail = e.current_node_id === firstEmailNodeId;
    const atSecondEmail = e.current_node_id === secondEmailNodeId;
    if (atFirstEmail && firstSent && secondJobs.length === 0) {
      console.log('  2. Enrollment is still at first email node and first email is sent, but no message_job for second email.');
      console.log('     -> Scheduler should have advanced after first send (next_run_at set by send worker). Check if scheduler ran and evaluateFlow returned the second node.');
      console.log('     -> Or batch_assign_jobs_to_interval never created the second job (e.g. no available interval, or enrollment not seen).');
    }
    if (atSecondEmail && secondJobs.length === 0) {
      console.log('  3. Enrollment current_node_id is already the second email node but no message_job for that node.');
      console.log('     -> batch_assign_jobs_to_interval should create jobs for enrollments with current_node_id = email node and no existing job. Check intervals and batch assign logs.');
    }
    if (secondJobs.length > 0 && secondJobs.every((j: any) => j.status === 'pending' || j.status === 'reserved')) {
      const j = secondJobs[0];
      const sched = j.scheduled_at ? new Date(j.scheduled_at) : null;
      if (sched && sched > new Date()) {
        console.log('  4. Second email has a message_job but scheduled_at is in the future -> send worker only claims jobs with scheduled_at <= NOW().');
      } else {
        console.log('  4. Second email has message_job with scheduled_at in past but status pending/reserved -> may not be claimed (e.g. campaign status, or claim_message_jobs_ready filters).');
      }
    }
  }
  if (secondEmailNodeId && !hasEdgeToSecond && edges?.length) {
    console.log('  5. Flow may have no edge from first email to second (e.g. path goes through wait node). Edges above show actual links.');
  }
  if (campaign.sending_interval_seconds == null) {
    console.log('  6. Campaign has no sending_interval_seconds -> batch interval assignment only runs for campaigns with sending_interval_seconds set; no jobs created via batch assign.');
  }
}

main();
