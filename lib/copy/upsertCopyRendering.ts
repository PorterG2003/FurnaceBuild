import type { SupabaseClient } from '@supabase/supabase-js';
import { copyPieceFingerprint } from './normalizeCopy';
import {
  expandSubjectSpintax,
  resolvedSubjectForBranchKey,
  selectSubjectBranchKey,
} from './expandSubjectSpintax';

type CopyDb = SupabaseClient;

type OccurrencePiece = {
  piece_id: string;
  kind: string;
  fingerprint: string;
  raw_text: string;
};

export async function upsertCopyRendering(params: {
  db: CopyDb;
  accountId: string;
  contentId: string;
  renderKey: string;
  pieceIds: string[];
}): Promise<string | null> {
  const { db, accountId, contentId, renderKey, pieceIds } = params;
  const uniquePieceIds = [...new Set(pieceIds)].sort();
  if (uniquePieceIds.length === 0) return null;

  const { data: rendering, error: upsertError } = await db
    .from('copy_renderings')
    .upsert(
      {
        account_id: accountId,
        content_id: contentId,
        render_key: renderKey,
      } as never,
      { onConflict: 'content_id,render_key' },
    )
    .select('id')
    .single();
  if (upsertError || !rendering) {
    throw new Error(`Failed to upsert copy rendering: ${upsertError?.message ?? 'missing row'}`);
  }
  const renderingId = String((rendering as { id: string }).id);

  const { data: existingRows, error: existingError } = await db
    .from('copy_rendering_pieces')
    .select('piece_id')
    .eq('rendering_id', renderingId);
  if (existingError) {
    throw new Error(`Failed to load rendering pieces: ${existingError.message}`);
  }
  const existingIds = (existingRows ?? [])
    .map((row) => String((row as { piece_id: string }).piece_id))
    .sort();
  const sameSet =
    existingIds.length === uniquePieceIds.length &&
    existingIds.every((id, i) => id === uniquePieceIds[i]);
  if (sameSet) return renderingId;

  const { error: deleteError } = await db
    .from('copy_rendering_pieces')
    .delete()
    .eq('rendering_id', renderingId);
  if (deleteError) {
    throw new Error(`Failed to replace rendering pieces: ${deleteError.message}`);
  }
  const { error: insertError } = await db.from('copy_rendering_pieces').insert(
    uniquePieceIds.map((pieceId) => ({
      rendering_id: renderingId,
      piece_id: pieceId,
    })) as never,
  );
  if (insertError) {
    throw new Error(`Failed to insert rendering pieces: ${insertError.message}`);
  }
  return renderingId;
}

async function loadOccurrencePieces(
  db: CopyDb,
  contentId: string,
): Promise<OccurrencePiece[]> {
  const { data, error } = await db
    .from('copy_piece_occurrences')
    .select('piece_id, copy_pieces!inner(id, kind, fingerprint, raw_text)')
    .eq('content_id', contentId);
  if (error) {
    throw new Error(`Failed to load copy occurrences: ${error.message}`);
  }
  return (data ?? []).flatMap((row) => {
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

async function subjectPieceIdForKey(
  pieces: OccurrencePiece[],
  rawSubject: string,
  renderKey: string,
): Promise<string | null> {
  const subjectPieces = pieces.filter((piece) => piece.kind === 'subject');
  if (subjectPieces.length === 0) return null;
  if (subjectPieces.length === 1) return subjectPieces[0]!.piece_id;

  const resolved = resolvedSubjectForBranchKey(rawSubject, renderKey);
  const fingerprint = await copyPieceFingerprint(resolved);
  const matched = subjectPieces.find((piece) => piece.fingerprint === fingerprint);
  if (matched) return matched.piece_id;

  const rawMatched = subjectPieces.find((piece) => piece.raw_text === resolved);
  return rawMatched?.piece_id ?? null;
}

export async function pieceIdsForSubjectRenderKey(params: {
  db: CopyDb;
  contentId: string;
  rawSubject: string;
  renderKey: string;
}): Promise<string[]> {
  const pieces = await loadOccurrencePieces(params.db, params.contentId);
  if (pieces.length === 0) return [];

  const expansion = expandSubjectSpintax(params.rawSubject);
  const unbranched = expansion.groups.length === 0;
  if (unbranched) {
    return pieces.map((piece) => piece.piece_id);
  }

  const bodyIds = pieces
    .filter((piece) => piece.kind !== 'subject')
    .map((piece) => piece.piece_id);
  const subjectId = await subjectPieceIdForKey(
    pieces,
    params.rawSubject,
    params.renderKey,
  );
  return subjectId ? [...bodyIds, subjectId] : bodyIds;
}

export async function resolveCopyContentForJob(params: {
  db: CopyDb;
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

  const { data: mapping, error: mapError } = await db
    .from('copy_variant_content_map')
    .select('content_id, copy_contents!inner(subject)')
    .eq('account_id', accountId)
    .eq('campaign_id', campaignId)
    .eq('flow_node_id', flowNodeId)
    .eq('variant_id', variantId)
    .eq('flow_version_number', flowVersionNumber)
    .maybeSingle();
  if (mapError || !mapping) return null;

  const contentId = String((mapping as { content_id?: string }).content_id ?? '');
  const contents = (mapping as { copy_contents?: { subject?: string } | { subject?: string }[] })
    .copy_contents;
  const contentRow = Array.isArray(contents) ? contents[0] : contents;
  const subject = String(contentRow?.subject ?? '');
  if (!contentId) return null;
  return { contentId, subject };
}

export async function upsertCopyRenderingForJob(params: {
  db: CopyDb;
  accountId: string;
  contentId: string;
  rawSubject: string;
  seed: string;
}): Promise<string | null> {
  const renderKey = selectSubjectBranchKey(params.rawSubject, params.seed);
  const pieceIds = await pieceIdsForSubjectRenderKey({
    db: params.db,
    contentId: params.contentId,
    rawSubject: params.rawSubject,
    renderKey,
  });
  if (pieceIds.length === 0) return null;
  return upsertCopyRendering({
    db: params.db,
    accountId: params.accountId,
    contentId: params.contentId,
    renderKey,
    pieceIds,
  });
}

export async function warmCacheSubjectRenderings(params: {
  db: CopyDb;
  accountId: string;
  contentId: string;
  rawSubject: string;
}): Promise<void> {
  const expansion = expandSubjectSpintax(params.rawSubject);
  for (const branch of expansion.branches) {
    const pieceIds = await pieceIdsForSubjectRenderKey({
      db: params.db,
      contentId: params.contentId,
      rawSubject: params.rawSubject,
      renderKey: branch.branchKey,
    });
    if (pieceIds.length === 0) continue;
    await upsertCopyRendering({
      db: params.db,
      accountId: params.accountId,
      contentId: params.contentId,
      renderKey: branch.branchKey,
      pieceIds,
    });
  }
}
