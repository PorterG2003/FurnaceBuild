import dns from 'node:dns/promises';
import net from 'node:net';
import { SupabaseClient } from '@supabase/supabase-js';
import { reportErrorToSlack } from '@furnace/slack-lib';
import type { Enrollment } from '../types.js';

type LeadRow = {
  id: string;
  email: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  website: string | null;
  linkedin_url: string | null;
  company_linkedin_url: string | null;
  source: string | null;
  custom_lead_data: Record<string, unknown> | null;
};

const METADATA_IPS = new Set([
  '169.254.169.254',
  '100.100.100.200',
]);

function isPrivateIp(ip: string): boolean {
  if (METADATA_IPS.has(ip)) return true;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  return false;
}

async function assertPublicHttpsUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('DataSender endpoint must be a valid absolute URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('DataSender endpoint must use HTTPS');
  }
  const hostname = url.hostname.trim().toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error('DataSender endpoint cannot target localhost');
  }
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error('DataSender endpoint cannot target private or link-local IPs');
    }
    return url;
  }
  const answers = await dns.lookup(hostname, { all: true });
  if (!answers.length) {
    throw new Error('DataSender endpoint hostname did not resolve');
  }
  for (const answer of answers) {
    if (isPrivateIp(answer.address)) {
      throw new Error('DataSender endpoint resolved to a private or link-local IP');
    }
  }
  return url;
}

function resolveTemplatePath(path: string, lead: LeadRow): string {
  if (path === 'email') return lead.email ?? '';
  if (path === 'name') return lead.name ?? '';
  if (path === 'first_name') return lead.first_name ?? '';
  if (path === 'last_name') return lead.last_name ?? '';
  if (path === 'company_name') return lead.company_name ?? '';
  if (path === 'website') return lead.website ?? '';
  if (path === 'linkedin_url') return lead.linkedin_url ?? '';
  if (path === 'company_linkedin_url') return lead.company_linkedin_url ?? '';
  if (path === 'source') return lead.source ?? '';
  if (path.startsWith('custom.')) {
    const key = path.slice('custom.'.length);
    const value = lead.custom_lead_data?.[key];
    return value == null ? '' : String(value);
  }
  return '';
}

function renderTemplateValue(value: unknown, lead: LeadRow): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath) => {
      return resolveTemplatePath(String(rawPath).trim(), lead);
    });
  }
  if (Array.isArray(value)) {
    return value.map((entry) => renderTemplateValue(entry, lead));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        renderTemplateValue(entry, lead),
      ])
    );
  }
  return value;
}

async function loadLead(supabase: SupabaseClient, leadId: string): Promise<LeadRow> {
  const { data, error } = await supabase
    .from('leads')
    .select('id, email, name, first_name, last_name, company_name, website, linkedin_url, company_linkedin_url, source, custom_lead_data')
    .eq('id', leadId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load lead for DataSender node: ${error.message}`);
  }
  if (!data) {
    throw new Error('Lead not found for DataSender node');
  }
  return data as LeadRow;
}

async function markEnrollmentForNextStep(
  supabase: SupabaseClient,
  enrollment: Enrollment,
  nodeId: string,
  flowVersionNumber: number | null
): Promise<void> {
  const { error } = await supabase
    .from('enrollments')
    .update({
      current_node_id: nodeId,
      current_flow_version_number: flowVersionNumber,
      next_run_at: new Date(Date.now() + 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', enrollment.id);
  if (error) {
    throw new Error(`Failed to advance enrollment after DataSender node: ${error.message}`);
  }
}

async function stopEnrollmentForFailure(
  supabase: SupabaseClient,
  enrollment: Enrollment,
  flowVersionNumber: number | null,
  message: string
): Promise<void> {
  const { error } = await supabase
    .from('enrollments')
    .update({
      state: 'stopped',
      current_flow_version_number: flowVersionNumber,
      next_run_at: null,
      stopped_reason: 'error',
      stopped_at: new Date().toISOString(),
      stopped_error_message: message,
      updated_at: new Date().toISOString(),
    })
    .eq('id', enrollment.id);
  if (error) {
    throw new Error(`Failed to stop enrollment after DataSender node failure: ${error.message}`);
  }
}

export async function handleDataSenderNode(
  enrollment: Enrollment,
  node: any,
  flowVersionNumber: number | null,
  supabase: SupabaseClient
): Promise<void> {
  const endpointUrl = node.node_data?.endpoint_url || node.node_data?.endpoint;
  const payloadTemplate = node.node_data?.payload_template ?? {};
  const onFailure = node.node_data?.on_failure === 'stop' ? 'stop' : 'continue';

  if (!endpointUrl || typeof endpointUrl !== 'string') {
    throw new Error('DataSender node is missing an endpoint URL');
  }

  const safeUrl = await assertPublicHttpsUrl(endpointUrl);
  const lead = await loadLead(supabase, enrollment.lead_id);
  const renderedPayload = renderTemplateValue(payloadTemplate, lead);

  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(safeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Furnace-DataSender/1.0',
        },
        body: JSON.stringify(renderedPayload),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      await markEnrollmentForNextStep(supabase, enrollment, node.id, flowVersionNumber);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  const errorMessage = lastError ?? 'DataSender request failed';
  reportErrorToSlack('DataSender request failed', {
    severity: 'warning',
    enrollment_id: enrollment.id,
    campaign_id: enrollment.campaign_id,
    node_id: node.id,
    endpoint_url: safeUrl.toString(),
    error: errorMessage,
  });

  if (onFailure === 'stop') {
    await stopEnrollmentForFailure(supabase, enrollment, flowVersionNumber, errorMessage);
    return;
  }

  await markEnrollmentForNextStep(supabase, enrollment, node.id, flowVersionNumber);
}

