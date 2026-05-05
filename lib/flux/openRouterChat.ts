export type OpenRouterResponseFormat =
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
    };

export interface OpenRouterChatCompletionParams {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  referer?: string;
  title?: string;
  responseFormat?: OpenRouterResponseFormat;
}

export type OpenRouterChatCompletionResult =
  | { ok: true; text: string }
  | { ok: false; details: string; httpStatus?: number };

export interface OpenRouterChatWithFallbacksParams
  extends Omit<OpenRouterChatCompletionParams, 'model'> {
  model: string;
  fallbackModels?: readonly string[];
}

export type OpenRouterChatWithFallbacksResult =
  | { ok: true; text: string; modelUsed: string }
  | { ok: false; details: string; modelTried: string };

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Tried after the configured primary model, in order, when routing is unavailable or the
 * upstream is temporarily overloaded.
 */
export const DEFAULT_OPENROUTER_MODEL_FALLBACKS = [
  'anthropic/claude-sonnet-4',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-3.5-sonnet-20240620',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'google/gemini-2.0-flash-001',
  'meta-llama/llama-3.3-70b-instruct',
  'mistralai/mistral-small-3.1-24b-instruct-2503',
  'deepseek/deepseek-chat',
  'qwen/qwen-2.5-72b-instruct',
] as const;

/** Best-effort string for logs / client from OpenRouter `error` + `metadata`. */
export function formatOpenRouterErrorDetails(body: Record<string, unknown>): string {
  const errField = body.error;
  if (typeof errField === 'string' && errField.trim()) return errField.trim();
  if (errField && typeof errField === 'object') {
    const e = errField as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e.message === 'string' && e.message.trim()) parts.push(e.message.trim());
    if (e.code !== undefined && e.code !== null && String(e.code).length > 0) {
      parts.push(`code=${String(e.code)}`);
    }
    const meta = e.metadata;
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      const m = meta as Record<string, unknown>;
      if (typeof m.provider_name === 'string' && m.provider_name.trim()) {
        parts.push(`provider=${m.provider_name.trim()}`);
      }
      if (m.raw !== undefined && m.raw !== null) {
        let rawStr: string;
        if (typeof m.raw === 'string') rawStr = m.raw;
        else {
          try {
            rawStr = JSON.stringify(m.raw);
          } catch {
            rawStr = String(m.raw);
          }
        }
        if (rawStr.length > 600) rawStr = `${rawStr.slice(0, 600)}…`;
        if (rawStr.trim()) parts.push(`upstream=${rawStr}`);
      }
    }
    if (parts.length > 0) return parts.join(' | ');
  }
  if (typeof body.message === 'string' && body.message.trim()) return body.message.trim();
  return '';
}

export async function openRouterChatCompletion(
  params: OpenRouterChatCompletionParams,
): Promise<OpenRouterChatCompletionResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (params.referer) headers['HTTP-Referer'] = params.referer;
  if (params.title) headers['X-OpenRouter-Title'] = params.title;

  const requestBody: Record<string, unknown> = {
    model: params.model,
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: params.user },
    ],
    max_tokens: 4096,
  };
  if (params.responseFormat) requestBody.response_format = params.responseFormat;

  let res: Response;
  try {
    res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, details: msg };
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const choices = body.choices as
    | Array<{
        message?: { content?: string | null };
        finish_reason?: string;
        native_finish_reason?: string;
      }>
    | undefined;
  const choice0 = choices?.[0];
  const text = choice0?.message?.content;
  const hasStringContent = typeof text === 'string' && text.trim().length > 0;
  const topDetails = formatOpenRouterErrorDetails(body);
  const finishReason = choice0?.finish_reason;

  if (!res.ok) {
    const msg = topDetails || `HTTP ${res.status}`;
    return { ok: false, details: msg, httpStatus: res.status };
  }

  if (body.error && !hasStringContent) {
    return {
      ok: false,
      details: topDetails || 'OpenRouter returned an error with no completion text',
      httpStatus: res.status,
    };
  }
  if (finishReason === 'error') {
    const native = choice0?.native_finish_reason;
    const base = topDetails || 'Model finished with error';
    const msg = native ? `${base} (native_finish_reason=${native})` : base;
    return { ok: false, details: msg, httpStatus: res.status };
  }
  if (!hasStringContent) {
    return {
      ok: false,
      details: topDetails || 'OpenRouter response missing choices[0].message.content (empty or null)',
      httpStatus: res.status,
    };
  }
  return { ok: true, text: text as string };
}

export function shouldTryNextOpenRouterModel(
  r: Extract<OpenRouterChatCompletionResult, { ok: false }>,
): boolean {
  const d = r.details;
  if (/no endpoints found/i.test(d)) return true;
  if (r.httpStatus === 429) return true;
  if (r.httpStatus === 503) return true;
  if (r.httpStatus === 500 || r.httpStatus === 502 || r.httpStatus === 504) return true;
  if (/rate limit|too many requests|overload|capacity|temporarily unavailable|try again/i.test(d)) {
    return true;
  }
  if (
    /provider returned|bad gateway|gateway timeout|server error|model is down|invalid response from provider|upstream=/i.test(
      d,
    )
  ) {
    return true;
  }
  return false;
}

export async function openRouterChatWithModelFallbacks(
  base: OpenRouterChatWithFallbacksParams,
): Promise<OpenRouterChatWithFallbacksResult> {
  const primary = base.model;
  const fallbacks = base.fallbackModels ?? DEFAULT_OPENROUTER_MODEL_FALLBACKS;
  const candidates = [primary, ...fallbacks.filter((model) => model !== primary)];
  let lastDetails = '';
  let lastTried = primary;
  for (const model of candidates) {
    lastTried = model;
    let result = await openRouterChatCompletion({ ...base, model });
    if (
      !result.ok &&
      base.responseFormat &&
      (result.httpStatus === 400 || result.httpStatus === 422) &&
      /json|schema|response_format|structured|invalid|unsupported|not support/i.test(result.details)
    ) {
      result = await openRouterChatCompletion({ ...base, model, responseFormat: undefined });
    }
    if (result.ok) return { ok: true, text: result.text, modelUsed: model };
    lastDetails = result.details;
    if (!shouldTryNextOpenRouterModel(result)) {
      return { ok: false, details: result.details, modelTried: model };
    }
  }
  return { ok: false, details: lastDetails, modelTried: lastTried };
}
