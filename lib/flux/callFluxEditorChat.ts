import { getAccessToken } from '@/lib/services/auth-token';
import type { Block, ContentAsset, FluxPreviewProspectInput } from '@/lib/flux/types';
import { getFluxEditorChatUrl } from '@/lib/flux/fluxEditorChatUrl';
import {
  fluxEditorChatResponseSchema,
  type FluxEditorChatResponse,
} from '@/lib/flux/editor/schemas';

export type FluxEditorChatResult =
  | { ok: true; data: FluxEditorChatResponse; model?: string }
  | { ok: false; message: string };

export async function callFluxEditorChat(params: {
  campaignId: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  editor: {
    name: string;
    offer_description: string;
    blocks: Block[];
    content_assets: ContentAsset[];
    copy_slots: string[];
    constraints: string;
    preview_prospect: FluxPreviewProspectInput;
  };
}): Promise<FluxEditorChatResult> {
  const url = getFluxEditorChatUrl();
  if (!url) {
    return {
      ok: false,
      message:
        'Flux editor chat URL is not configured. Deploy the Amplify backend and ensure amplify_outputs.json includes custom.fluxEditorChatUrl, or set EXPO_PUBLIC_FLUX_EDITOR_CHAT_URL.',
    };
  }

  const token = await getAccessToken();
  if (!token) {
    return { ok: false, message: 'You must be signed in to use chat.' };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        campaignId: params.campaignId,
        messages: params.messages,
        editor: params.editor,
      }),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Network error';
    return { ok: false, message: msg };
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const detail = [data.error, data.details].filter(Boolean).join(': ');
    return {
      ok: false,
      message: detail || `Request failed (${res.status} ${res.statusText})`,
    };
  }

  const parsed = fluxEditorChatResponseSchema.safeParse({
    assistantMessage: data.assistantMessage,
    operations: data.operations,
    summary: data.summary,
    requiresAiPreview: data.requiresAiPreview,
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: `Invalid chat response: ${parsed.error.message}`,
    };
  }

  const model = typeof data.model === 'string' ? data.model : undefined;
  return { ok: true, data: parsed.data, model };
}
