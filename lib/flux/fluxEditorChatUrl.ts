import outputs from '@/amplify_outputs.json';

/**
 * Lambda Function URL for `fluxEditorChat` (POST + Bearer Supabase JWT).
 * `custom.fluxEditorChatUrl` after `npx ampx sandbox` / deploy, or
 * `EXPO_PUBLIC_FLUX_EDITOR_CHAT_URL` in `.env.local`.
 */
export function getFluxEditorChatUrl(): string | undefined {
  const fromEnv = process.env.EXPO_PUBLIC_FLUX_EDITOR_CHAT_URL?.trim();
  if (fromEnv) return fromEnv;

  const custom = (outputs as { custom?: { fluxEditorChatUrl?: string } }).custom;
  return custom?.fluxEditorChatUrl?.trim();
}
