import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { stripHtml } from '../../../lib/email/parse-body';
import * as parseCopyStructureNamespace from '../../../lib/copy/parseCopyStructure';
import type {
  CopyArchetypeCandidate,
  ParsedCopyPiece,
} from '../../../lib/copy/parseCopyStructure';
import * as normalizeCopyNamespace from '../../../lib/copy/normalizeCopy';
import * as openRouterTransportNamespace from '../../../lib/copy/openRouterCopyTransport';
import * as expandSubjectSpintaxNamespace from '../../../lib/copy/expandSubjectSpintax';
import * as upsertCopyRenderingNamespace from '../../../lib/copy/upsertCopyRendering';

const parseCopyStructureModule =
  (parseCopyStructureNamespace as { default?: typeof parseCopyStructureNamespace }).default ??
  parseCopyStructureNamespace;
const normalizeCopyModule =
  (normalizeCopyNamespace as { default?: typeof normalizeCopyNamespace }).default ??
  normalizeCopyNamespace;
const openRouterTransportModule =
  (openRouterTransportNamespace as { default?: typeof openRouterTransportNamespace }).default ??
  openRouterTransportNamespace;
const upsertCopyRenderingModule =
  (upsertCopyRenderingNamespace as { default?: typeof upsertCopyRenderingNamespace }).default ??
  upsertCopyRenderingNamespace;
const expandSubjectSpintaxModule =
  (expandSubjectSpintaxNamespace as { default?: typeof expandSubjectSpintaxNamespace }).default ??
  expandSubjectSpintaxNamespace;
const {
  buildCopyStructurePrompt,
  parseCopyStructureResponse,
  COPY_PARSE_PROMPT_VERSION,
} = parseCopyStructureModule;
const { copyPieceFingerprint } = normalizeCopyModule;
const { callOpenRouterCopyParse } = openRouterTransportModule;
const { expandSubjectSpintax } = expandSubjectSpintaxModule;
const { warmCacheSubjectRenderings } = upsertCopyRenderingModule;

const DEFAULT_COPY_PARSE_MODEL = 'google/gemini-2.5-flash-lite';
const DEFAULT_BATCH_LIMIT = 25;
const MAX_PARSE_ATTEMPTS = 3;

type FunctionUrlEvent = {
  requestContext?: { http?: { method?: string } };
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
};

type AsyncInvokeEvent = {
  accountId?: string;
  limit?: number;
};

type CopyContentRow = {
  id: string;
  account_id: string;
  subject: string | null;
  template: string | null;
  body_text: string | null;
  body_html: string | null;
  parse_attempts: number | null;
};

type OpenRouterTransport = (prompt: {
  system: string;
  user: string;
}) => Promise<string>;

function jsonResponse(statusCode: number, body: Record<string, unknown>) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

function getHeader(event: FunctionUrlEvent, name: string): string {
  const wanted = name.toLowerCase();
  const entry = Object.entries(event.headers ?? {}).find(
    ([key]) => key.toLowerCase() === wanted,
  );
  return entry?.[1] ?? '';
}

function parseUrlBody(event: FunctionUrlEvent): Record<string, unknown> {
  const raw = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body
    : '{}';
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function bodyTextForContent(content: CopyContentRow): string {
  const bodyText = String(content.body_text ?? '').trim();
  if (bodyText) return bodyText;
  const template = String(content.template ?? '').trim();
  if (template) return /<[a-z][\s\S]*>/i.test(template) ? stripHtml(template) : template;
  return stripHtml(content.body_html ?? '');
}

interface SavedPieceRecord {
  pieceIndex: number;
  pieceId: string;
  kind: string;
  fingerprint: string;
}

async function saveParsedPieces(
  db: SupabaseClient,
  content: CopyContentRow,
  pieces: ParsedCopyPiece[],
  archetypes: CopyArchetypeCandidate[],
): Promise<SavedPieceRecord[]> {
  const occurrenceRows: Array<{
    account_id: string;
    content_id: string;
    piece_id: string;
    position: number;
  }> = [];
  const saved: SavedPieceRecord[] = [];

  for (let idx = 0; idx < pieces.length; idx++) {
    const piece = pieces[idx]!;
    const fingerprint = await copyPieceFingerprint(piece.rawText);
    let archetypeId = piece.archetype.existingId;
    if (!archetypeId) {
      const { data: archetype, error } = await db
        .from('copy_archetypes')
        .upsert(
          {
            account_id: content.account_id,
            kind: piece.kind,
            slug: piece.archetype.slug,
            name: piece.archetype.name,
            description: piece.archetype.description,
          } as never,
          { onConflict: 'account_id,kind,slug' },
        )
        .select('id, account_id, kind, slug, name, description')
        .single();
      if (error || !archetype) {
        throw new Error(`Failed to upsert archetype: ${error?.message ?? 'missing row'}`);
      }
      archetypeId = String((archetype as { id: string }).id);
      if (!archetypes.some((candidate) => candidate.id === archetypeId)) {
        archetypes.push({
          id: archetypeId,
          kind: piece.kind,
          slug: piece.archetype.slug,
          name: piece.archetype.name,
          description: piece.archetype.description,
        });
      }
    }

    const { data: copyPiece, error } = await db
      .from('copy_pieces')
      .upsert(
        {
          account_id: content.account_id,
          kind: piece.kind,
          fingerprint,
          raw_text: piece.rawText,
          display_text: piece.displayText,
          archetype_id: archetypeId,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: 'account_id,kind,fingerprint' },
      )
      .select('id')
      .single();
    if (error || !copyPiece) {
      throw new Error(`Failed to upsert copy piece: ${error?.message ?? 'missing row'}`);
    }
    const pieceId = String((copyPiece as { id: string }).id);
    occurrenceRows.push({
      account_id: content.account_id,
      content_id: content.id,
      piece_id: pieceId,
      position: piece.position,
    });
    saved.push({ pieceIndex: idx, pieceId, kind: piece.kind, fingerprint });
  }

  const { error: deleteError } = await db
    .from('copy_piece_occurrences')
    .delete()
    .eq('content_id', content.id);
  if (deleteError) {
    throw new Error(`Failed to replace piece occurrences: ${deleteError.message}`);
  }
  if (occurrenceRows.length > 0) {
    const { error: insertError } = await db
      .from('copy_piece_occurrences')
      .insert(occurrenceRows as never);
    if (insertError) {
      throw new Error(`Failed to insert piece occurrences: ${insertError.message}`);
    }
  }

  return saved;
}

async function markParseFailure(
  db: SupabaseClient,
  content: CopyContentRow,
  error: unknown,
): Promise<void> {
  const attempts = Number(content.parse_attempts ?? 1);
  const terminal = attempts >= MAX_PARSE_ATTEMPTS;
  const delayMinutes = Math.min(15 * 2 ** Math.max(0, attempts - 1), 6 * 60);
  await db
    .from('copy_contents')
    .update({
      parse_status: terminal ? 'failed' : 'queued',
      parse_error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
      parse_next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
      parse_claimed_at: null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', content.id);
}

export async function processCopyParseBatch(params: {
  db: SupabaseClient;
  accountId: string;
  limit: number;
  model: string;
  transport: OpenRouterTransport;
}): Promise<{ processed: number; failed: number; remaining: number }> {
  const { db, accountId, limit, model, transport } = params;
  const { error: reconcileError } = await db.rpc('reconcile_copy_versions', {
    p_account_id: accountId,
    p_limit: Math.max(limit, 100),
  } as never);
  if (reconcileError) {
    throw new Error(`Copy registration reconcile failed: ${reconcileError.message}`);
  }

  const { data: candidateRows, error: candidateError } = await db
    .from('copy_archetypes')
    .select('id, kind, slug, name, description')
    .eq('account_id', accountId)
    .order('kind')
    .order('created_at');
  if (candidateError) {
    throw new Error(`Failed to load archetypes: ${candidateError.message}`);
  }
  const archetypes = (candidateRows ?? []) as unknown as CopyArchetypeCandidate[];

  const { data: claimedRows, error: claimError } = await db.rpc(
    'claim_copy_contents_to_parse',
    { p_account_id: accountId, p_limit: limit } as never,
  );
  if (claimError) throw new Error(`Failed to claim copy contents: ${claimError.message}`);

  let processed = 0;
  let failed = 0;
  for (const content of (claimedRows ?? []) as unknown as CopyContentRow[]) {
    try {
      const rawSubject = String(content.subject ?? '');
      const body = bodyTextForContent(content);
      const expansion = expandSubjectSpintax(rawSubject);

      const allPieces: ParsedCopyPiece[] = [];
      const bodyArchetypes = archetypes.filter((a) => a.kind !== 'subject');

      for (let bi = 0; bi < expansion.branches.length; bi++) {
        const branch = expansion.branches[bi]!;
        const input = {
          subject: branch.resolvedSubject,
          body,
          archetypes: bodyArchetypes,
        };
        const raw = await transport(buildCopyStructurePrompt(input));
        const pieces = parseCopyStructureResponse(raw, input);

        if (bi === 0) {
          allPieces.push(...pieces);
        } else {
          allPieces.push(...pieces.filter((p) => p.kind === 'subject'));
        }
      }

      await saveParsedPieces(db, content, allPieces, archetypes);
      try {
        await warmCacheSubjectRenderings({
          db,
          accountId: content.account_id,
          contentId: content.id,
          rawSubject,
        });
      } catch (error) {
        console.error(
          '[copyStructureParse] warm-cache renderings failed',
          content.id,
          error,
        );
      }

      const { error: updateError } = await db
        .from('copy_contents')
        .update({
          parse_status: 'done',
          parse_error: null,
          parse_claimed_at: null,
          parsed_at: new Date().toISOString(),
          parse_model: model,
          parse_prompt_version: COPY_PARSE_PROMPT_VERSION,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', content.id);
      if (updateError) throw updateError;
      processed += 1;
    } catch (error) {
      failed += 1;
      console.error('[copyStructureParse] content failed', content.id, error);
      await markParseFailure(db, content, error);
    }
  }

  const { count: queuedCount } = await db
    .from('copy_contents')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .in('parse_status', ['queued', 'processing']);
  const { count: unregisteredCount } = await db
    .from('campaign_flow_versions')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .is('copy_registered_at', null);

  return {
    processed,
    failed,
    remaining: Number(queuedCount ?? 0) + Number(unregisteredCount ?? 0),
  };
}

async function authorizeUrlRequest(
  db: SupabaseClient,
  event: FunctionUrlEvent,
  accountId: string,
): Promise<boolean> {
  const internalSecret = process.env.COPY_PARSE_INTERNAL_SECRET ?? '';
  const providedInternal = getHeader(event, 'x-furnace-internal-secret');
  if (internalSecret && providedInternal === internalSecret) return true;

  const token = getHeader(event, 'authorization').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const {
    data: { user },
    error,
  } = await db.auth.getUser(token);
  if (error || !user) return false;
  const { data: membership } = await db
    .from('account_users')
    .select('id')
    .eq('account_id', accountId)
    .eq('user_id', user.id)
    .maybeSingle();
  return !!membership;
}

export const handler = async (rawEvent: FunctionUrlEvent | AsyncInvokeEvent) => {
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? '';
  const openRouterApiKey = process.env.OPENROUTER_API_KEY ?? '';
  const model =
    process.env.OPENROUTER_COPY_PARSE_MODEL?.trim() || DEFAULT_COPY_PARSE_MODEL;
  if (!supabaseUrl || !supabaseSecretKey || !openRouterApiKey) {
    return jsonResponse(500, { error: 'Missing environment configuration' });
  }

  const db = createClient(supabaseUrl, supabaseSecretKey);
  const isFunctionUrl = 'requestContext' in rawEvent;
  let body: Record<string, unknown>;
  try {
    body = isFunctionUrl
      ? parseUrlBody(rawEvent as FunctionUrlEvent)
      : (rawEvent as AsyncInvokeEvent as Record<string, unknown>);
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const accountId = typeof body.accountId === 'string' ? body.accountId : '';
  if (!accountId) return jsonResponse(400, { error: 'accountId is required' });

  if (
    isFunctionUrl &&
    !(await authorizeUrlRequest(db, rawEvent as FunctionUrlEvent, accountId))
  ) {
    return jsonResponse(403, { error: 'Access denied' });
  }

  const limit = Math.max(
    1,
    Math.min(Number.isFinite(Number(body.limit)) ? Number(body.limit) : DEFAULT_BATCH_LIMIT, 100),
  );
  try {
    const result = await processCopyParseBatch({
      db,
      accountId,
      limit,
      model,
      transport: (prompt) =>
        callOpenRouterCopyParse({ apiKey: openRouterApiKey, model, prompt }),
    });
    return isFunctionUrl ? jsonResponse(200, result) : result;
  } catch (error) {
    console.error('[copyStructureParse] invocation failed', error);
    return isFunctionUrl
      ? jsonResponse(500, {
          error: error instanceof Error ? error.message : 'Copy parsing failed',
        })
      : Promise.reject(error);
  }
};
