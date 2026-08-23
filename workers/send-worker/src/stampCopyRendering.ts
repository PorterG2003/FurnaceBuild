import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildSpintaxSeed,
  expandSubjectSpintax,
  resolvedSubjectForBranchKey,
  selectSubjectBranchKey,
} from '../../../lib/email/dist/index.js';
import type { MessageJob } from './types.js';

const MERGE_TAG_PATTERN = /\{\{[\s\S]*?\}\}/g;

function fingerprintCopy(value: string): string {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(MERGE_TAG_PATTERN, '{{merge}}');
  return createHash('sha256').update(normalized).digest('hex');
}

type OccurrencePiece = {
  piece_id: string;
  kind: string;
  fingerprint: string;
  raw_text: string;
};

async function resolveCopyContent(params: {
  db: SupabaseClient;
  accountId: string;
  campaignId: string;
  nodeId: string | null | undefined;
  variantId: string | null | undefined;
  flowVersionNumber: number | null | undefined;
}): Promise<{ contentId: string; subject: string } | null> {
  const { db, accountId, campaignId, nodeId, variantId, flowVersionNumber } = params;
  if (!nodeId || !variantId || !flowVersionNumber) return null;

  const { data: node, error: nodeError } = await db
    .from('nodes')
    .select('flow_node_id')
    .eq('id', nodeId)
    .maybeSingle();
  if (nodeError || !node) return null;
  const flowNodeId = String((node as { flow_node_id?: string }).flow_node_id ?? '');
  if (!flowNodeId) return null;

  const mappingSelect = () =>
    db
      .from('copy_variant_content_map')
      .select('content_id, copy_contents!inner(subject)')
      .eq('account_id', accountId)
      .eq('campaign_id', campaignId)
      .eq('variant_id', variantId)
      .eq('flow_version_number', flowVersionNumber);

  const { data: mappedByNode, error: mapError } = await mappingSelect()
    .eq('flow_node_id', flowNodeId)
    .maybeSingle();
  const mappingMissingColumn =
    Boolean(mapError?.message?.includes('flow_node_id')) || mapError?.code === '42703';
  let mapping = !mapError ? mappedByNode : null;
  if (!mapping && (mappingMissingColumn || !mapError)) {
    const fallback = mappingMissingColumn
      ? await mappingSelect().limit(1).maybeSingle()
      : await mappingSelect().is('flow_node_id', null).limit(1).maybeSingle();
    if (fallback.error && !mappingMissingColumn) return null;
    mapping = fallback.data ?? null;
  }
  if (!mapping) return null;

  const contentId = String((mapping as { content_id?: string }).content_id ?? '');
  const contents = (mapping as { copy_contents?: { subject?: string } | { subject?: string }[] })
    .copy_contents;
  const contentRow = Array.isArray(contents) ? contents[0] : contents;
  if (!contentId) return null;
  return { contentId, subject: String(contentRow?.subject ?? '') };
}

async function loadOccurrencePieces(
  db: SupabaseClient,
  contentId: string,
): Promise<OccurrencePiece[]> {
  const { data, error } = await db
    .from('copy_piece_occurrences')
    .select('piece_id, copy_pieces!inner(id, kind, fingerprint, raw_text)')
    .eq('content_id', contentId);
  if (error || !data) return [];
  return data.flatMap((row) => {
    const piece = (row as { copy_pieces?: unknown }).copy_pieces;
    const record = Array.isArray(piece) ? piece[0] : piece;
    if (!record || typeof record !== 'object') return [];
    const typed = record as {
      id?: string;
      kind?: string;
      fingerprint?: string;
      raw_text?: string;
    };
    const pieceId = String(typed.id ?? (row as { piece_id?: string }).piece_id ?? '');
    if (!pieceId) return [];
    return [
      {
        piece_id: pieceId,
        kind: String(typed.kind ?? ''),
        fingerprint: String(typed.fingerprint ?? ''),
        raw_text: String(typed.raw_text ?? ''),
      },
    ];
  });
}

function pieceIdsForRenderKey(
  pieces: OccurrencePiece[],
  rawSubject: string,
  renderKey: string,
): string[] {
  if (pieces.length === 0) return [];
  const expansion = expandSubjectSpintax(rawSubject);
  if (expansion.groups.length === 0) {
    return pieces.map((piece) => piece.piece_id);
  }
  const bodyIds = pieces
    .filter((piece) => piece.kind !== 'subject')
    .map((piece) => piece.piece_id);
  const subjectPieces = pieces.filter((piece) => piece.kind === 'subject');
  if (subjectPieces.length === 0) return bodyIds;
  if (subjectPieces.length === 1) return [...bodyIds, subjectPieces[0]!.piece_id];
  const resolved = resolvedSubjectForBranchKey(rawSubject, renderKey);
  const fp = fingerprintCopy(resolved);
  const matched =
    subjectPieces.find((piece) => piece.fingerprint === fp) ??
    subjectPieces.find((piece) => piece.raw_text === resolved);
  return matched ? [...bodyIds, matched.piece_id] : bodyIds;
}

async function upsertRendering(params: {
  db: SupabaseClient;
  accountId: string;
  contentId: string;
  renderKey: string;
  pieceIds: string[];
}): Promise<string | null> {
  const uniquePieceIds = [...new Set(params.pieceIds)].sort();
  if (uniquePieceIds.length === 0) return null;

  const { data: rendering, error: upsertError } = await params.db
    .from('copy_renderings')
    .upsert(
      {
        account_id: params.accountId,
        content_id: params.contentId,
        render_key: params.renderKey,
      } as never,
      { onConflict: 'content_id,render_key' },
    )
    .select('id')
    .single();
  if (upsertError || !rendering) return null;
  const renderingId = String((rendering as { id: string }).id);

  const { data: existingRows } = await params.db
    .from('copy_rendering_pieces')
    .select('piece_id')
    .eq('rendering_id', renderingId);
  const existingIds = (existingRows ?? [])
    .map((row) => String((row as { piece_id: string }).piece_id))
    .sort();
  const sameSet =
    existingIds.length === uniquePieceIds.length &&
    existingIds.every((id, i) => id === uniquePieceIds[i]);
  if (sameSet) return renderingId;

  await params.db.from('copy_rendering_pieces').delete().eq('rendering_id', renderingId);
  const { error: insertError } = await params.db.from('copy_rendering_pieces').insert(
    uniquePieceIds.map((pieceId) => ({
      rendering_id: renderingId,
      piece_id: pieceId,
    })) as never,
  );
  if (insertError) return null;
  return renderingId;
}

/**
 * Find-or-create the copy rendering for this send. Returns null if copy is
 * unparsed or lookup fails — callers must not fail the send.
 */
export async function stampCopyRenderingId(params: {
  db: SupabaseClient;
  accountId: string | null | undefined;
  messageJob: MessageJob;
}): Promise<string | null> {
  const { db, accountId, messageJob } = params;
  if (!accountId) return null;
  try {
    const content = await resolveCopyContent({
      db,
      accountId,
      campaignId: messageJob.campaign_id,
      nodeId: messageJob.node_id,
      variantId: messageJob.variant_id,
      flowVersionNumber: messageJob.flow_version_number ?? null,
    });
    if (!content) return null;

    const seed = buildSpintaxSeed({
      campaignId: messageJob.campaign_id,
      leadId: messageJob.lead_id,
      variantId: messageJob.variant_id,
    });
    const renderKey = selectSubjectBranchKey(content.subject, seed);
    const pieces = await loadOccurrencePieces(db, content.contentId);
    const pieceIds = pieceIdsForRenderKey(pieces, content.subject, renderKey);
    return await upsertRendering({
      db,
      accountId,
      contentId: content.contentId,
      renderKey,
      pieceIds,
    });
  } catch {
    return null;
  }
}
