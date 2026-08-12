export type SerperOrganic = {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
};

export type SerperResponse = {
  knowledgeGraph?: { website?: string; title?: string; description?: string };
  organic?: SerperOrganic[];
};

export async function serperSearch(
  query: string,
  options: {
    apiKey?: string;
    num?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<SerperResponse> {
  const apiKey = options.apiKey ?? process.env.SERPER_API_KEY?.trim();
  if (!apiKey) throw new Error('SERPER_API_KEY is required');

  const fetchImpl = options.fetchImpl ?? fetch;
  const resp = await fetchImpl('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({
      q: query,
      gl: 'us',
      hl: 'en',
      num: options.num ?? 5,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Serper failed: ${resp.status} ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as SerperResponse;
}
