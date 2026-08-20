import outputs from '../../amplify_outputs.json';
import { supabase } from '../supabase/client';

function copyStructureParseUrl(): string | null {
  const custom = (
    outputs as { custom?: { copyStructureParseUrl?: string } }
  ).custom;
  return custom?.copyStructureParseUrl?.trim() || null;
}

/**
 * Best-effort browser kick. Registration is already committed before this is
 * called, so a missing URL or network failure must never fail the campaign save.
 */
export async function kickCopyParseFromClient(accountId: string): Promise<void> {
  const url = copyStructureParseUrl();
  if (!url || !accountId) return;

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accountId }),
    });
  } catch (error) {
    console.warn('[copyStructureParse] client kick failed', error);
  }
}
