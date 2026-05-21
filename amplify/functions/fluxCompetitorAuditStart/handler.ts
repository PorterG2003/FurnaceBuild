import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { isValidFluxServiceArea } from '../../../lib/flux/fluxServiceArea';
import type { Block, PageConfig } from '../../../lib/flux/types';

const FLUX_FLAG_KEY = 'flux';

function isFunctionUrlEvent(event: unknown): event is {
  headers: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
} {
  return Boolean(event && typeof event === 'object' && event !== null && 'headers' in event);
}

function response(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function assertFluxAccess(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  const { data, error } = await supabase
    .from('user_access_flags')
    .select('flag_key')
    .eq('user_id', userId)
    .eq('flag_key', FLUX_FLAG_KEY)
    .maybeSingle();
  if (error) {
    console.error('[fluxCompetitorAuditStart] user_access_flags', error.message);
    return { ok: false, status: 500, body: { ok: false, error: 'Failed to verify access' } };
  }
  if (!data) {
    return { ok: false, status: 403, body: { ok: false, error: 'Flux access denied' } };
  }
  return { ok: true };
}

const bodySchema = z.object({
  pageId: z.string().uuid(),
  blockId: z.string().min(1).max(200),
});

export const handler = async (event: unknown) => {
  try {
    if (!isFunctionUrlEvent(event)) {
      return response(500, { ok: false, error: 'Unsupported invocation' });
    }
    const smArn = process.env.FLUX_COMPETITOR_AUDIT_STATE_MACHINE_ARN?.trim();
    const supabaseUrl = process.env.SUPABASE_URL ?? '';
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? '';
    if (!smArn || !supabaseUrl || !supabaseSecretKey) {
      return response(500, { ok: false, error: 'Missing server configuration' });
    }

    const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'POST';
    if (method !== 'POST') {
      return response(405, { ok: false, error: 'Method not allowed' });
    }

    const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return response(401, { ok: false, error: 'Missing authorization token' });
    }

    const supabase = createClient(supabaseUrl, supabaseSecretKey);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return response(401, { ok: false, error: 'Invalid token' });
    }

    const access = await assertFluxAccess(supabase, user.id);
    if (!access.ok) {
      return response(access.status, access.body);
    }

    const rawBody =
      typeof event.body === 'string'
        ? event.body
          ? event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf8')
            : event.body
          : '{}'
        : '{}';

    let parsedBody: z.infer<typeof bodySchema>;
    try {
      const json = JSON.parse(rawBody) as unknown;
      const r = bodySchema.safeParse(json);
      if (!r.success) {
        return response(400, { ok: false, error: 'Invalid request body', details: r.error.flatten() });
      }
      parsedBody = r.data;
    } catch {
      return response(400, { ok: false, error: 'Invalid JSON body' });
    }

    const { data: page, error: pageErr } = await supabase
      .from('flux_prospect_pages')
      .select('id, account_id, prospect_id, page_config')
      .eq('id', parsedBody.pageId)
      .maybeSingle();
    if (pageErr || !page) {
      return response(404, { ok: false, error: 'Page not found' });
    }

    const { data: membership } = await supabase
      .from('account_users')
      .select('account_id')
      .eq('user_id', user.id)
      .eq('account_id', page.account_id)
      .maybeSingle();
    if (!membership) {
      return response(403, { ok: false, error: 'Forbidden' });
    }

    const cfg = page.page_config as PageConfig | null;
    const blocks = Array.isArray(cfg?.blocks) ? cfg!.blocks : [];
    const block = blocks.find((b) => b.id === parsedBody.blockId) as Block | undefined;
    if (!block || block.type !== 'competitor_ad_audit') {
      return response(400, { ok: false, error: 'Block not found or wrong type' });
    }

    const { data: prospect, error: prErr } = await supabase
      .from('flux_prospects')
      .select('service_area')
      .eq('id', page.prospect_id)
      .maybeSingle();
    if (prErr || !prospect || !isValidFluxServiceArea(prospect.service_area)) {
      return response(400, { ok: false, error: 'Prospect service area is required for competitor audit' });
    }

    const blockIdNorm = parsedBody.blockId.trim();
    const idempotencyKey = `competitor_ad_audit:v1:${page.account_id}:${page.id}:${blockIdNorm}`;

    const { data: existing } = await supabase
      .from('flux_async_jobs')
      .select('id, status')
      .eq('idempotency_key', idempotencyKey)
      .in('status', ['queued', 'running'])
      .maybeSingle();

    let jobId: string;
    if (existing?.id) {
      jobId = existing.id;
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('flux_async_jobs')
        .insert({
          account_id: page.account_id,
          job_type: 'competitor_ad_audit',
          subject_type: 'flux_prospect_page',
          subject_id: page.id,
          payload: { block_id: blockIdNorm, audit_config_version: 'v1' },
          status: 'queued',
          idempotency_key: idempotencyKey,
        })
        .select('id')
        .single();
      if (insErr || !inserted) {
        if (String(insErr?.code) === '23505') {
          const { data: again } = await supabase
            .from('flux_async_jobs')
            .select('id')
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle();
          if (again?.id) jobId = again.id;
          else return response(409, { ok: false, error: 'Could not create or reuse job' });
        } else {
          return response(500, { ok: false, error: insErr?.message ?? 'Insert failed' });
        }
      } else {
        jobId = inserted.id;
      }
    }

    const sfn = new SFNClient({});
    const exec = await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: smArn,
        input: JSON.stringify({ jobId }),
        name: `flux-audit-${jobId}-${Date.now()}`.slice(0, 80),
      }),
    );

    await supabase
      .from('flux_async_jobs')
      .update({
        external_execution_arn: exec.executionArn ?? null,
      })
      .eq('id', jobId);

    const nextBlocks = blocks.map((b) => {
      if (b.id !== parsedBody.blockId) return b;
      if (b.type !== 'competitor_ad_audit') return b;
      return {
        ...b,
        props: {
          ...b.props,
          status: 'running' as const,
        },
      };
    });
    const { error: upPageErr } = await supabase
      .from('flux_prospect_pages')
      .update({ page_config: { ...cfg, blocks: nextBlocks } as never })
      .eq('id', page.id);
    if (upPageErr) {
      return response(500, { ok: false, error: upPageErr.message });
    }

    return response(200, { ok: true, jobId, executionArn: exec.executionArn ?? null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[fluxCompetitorAuditStart] unhandled', err);
    return response(500, { ok: false, error: 'Internal error', details: message });
  }
};
