const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const COPY_PARSE_INLINE_LLM_ATTEMPTS = 3;

function retryDelayMs(attempt: number): number {
  return Math.min(250 * 2 ** Math.max(0, attempt - 1), 2_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callOpenRouterCopyParse(params: {
  apiKey: string;
  model: string;
  prompt: { system: string; user: string };
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchImpl = params.fetchImpl ?? fetch;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= COPY_PARSE_INLINE_LLM_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetchImpl(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: params.model,
          messages: [
            { role: 'system', content: params.prompt.system },
            { role: 'user', content: params.prompt.user },
          ],
          temperature: 0,
          max_tokens: 8_192,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        const message =
          typeof body.error === 'string'
            ? body.error
            : (body.error as { message?: string } | undefined)?.message;
        throw new Error(message || `OpenRouter HTTP ${response.status}`);
      }
      const choices = body.choices as
        | Array<{
            finish_reason?: string | null;
            message?: { content?: string | null };
          }>
        | undefined;
      const choice = choices?.[0];
      if (choice?.finish_reason === 'length') {
        throw new Error('OpenRouter response was truncated (finish_reason=length)');
      }
      const content = choice?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('OpenRouter returned an empty response');
      }
      return content;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < COPY_PARSE_INLINE_LLM_ATTEMPTS) {
        await sleep(retryDelayMs(attempt));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error('OpenRouter request failed');
}
