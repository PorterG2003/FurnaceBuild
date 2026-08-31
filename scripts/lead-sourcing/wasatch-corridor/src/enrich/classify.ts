import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLASSIFY_PROMPT_VERSION, DEFAULT_OPENROUTER_MODEL, OUTBOUND_SHOP_RE } from '../../config/sources.js';
import { readCached, writeCached } from '../lib/cache.js';
import { fixturesDir } from '../lib/env.js';
import type { B2bType, CompanyRecord, CustomerGeo, PipelineContext, PrimaryBuyer } from '../types.js';
import type { CrawledSite } from './crawl.js';
import { combinedText } from './crawl.js';

export type ClassifyResult = {
  b2b_type: B2bType;
  primary_buyer: PrimaryBuyer;
  customer_geo: CustomerGeo;
  what_they_sell: string;
  category: string;
  target_audience: string;
  is_outbound_shop: boolean;
  has_sales_motion: boolean;
};

const SYSTEM = `You classify companies for B2B outbound. Return JSON only with ALL keys populated.
Required non-empty strings:
- what_they_sell: one sentence, the product/service and who buys it (never blank)
- category: short industry category (never blank, never "")
- target_audience: specific buyer (e.g. "licensed mental health therapists"), not "professionals"
b2b_type must be one of: b2b, b2b2c, hybrid, b2c.
b2b2c = one business buyer whose end users are consumers.
hybrid = selling separately to both businesses and consumers.
Do not conflate b2b2c and hybrid.
primary_buyer must be "business" or "consumer": who actually pays. If consumers pay and a wholesale channel exists, still "consumer". Only "business" if companies/institutions are the primary payer.
customer_geo must be one of: local, regional, us, global.
- local = metro / city / "we serve the valley" / one state
- regional = a few states, not nationwide (e.g. Intermountain West only)
- us = sells anywhere in the United States (US-only is us, not local)
- global = sells outside the US too
HQ location is not customer_geo.
is_outbound_shop is true only if the product IS outbound prospecting / cold email agency / SDR-as-a-service / appointment setting.
has_sales_motion is true if anyone takes meetings (demo, sales team, "talk to sales").`;

function parsePrimaryBuyer(value: unknown): PrimaryBuyer {
  return value === 'business' || value === 'consumer' ? value : 'unknown';
}

function parseCustomerGeo(value: unknown): CustomerGeo {
  return value === 'local' || value === 'regional' || value === 'us' || value === 'global' ? value : 'unknown';
}

export function parseClassify(raw: string): ClassifyResult {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let json: Partial<ClassifyResult> = {};
  try {
    json = JSON.parse(trimmed) as Partial<ClassifyResult>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        json = JSON.parse(match[0]) as Partial<ClassifyResult>;
      } catch {
        json = {};
      }
    }
  }
  const type = json.b2b_type;
  const b2b_type: B2bType =
    type === 'b2b' || type === 'b2b2c' || type === 'hybrid' || type === 'b2c' ? type : 'unknown';
  return {
    b2b_type,
    primary_buyer: parsePrimaryBuyer(json.primary_buyer),
    customer_geo: parseCustomerGeo(json.customer_geo),
    what_they_sell: String(json.what_they_sell ?? '').trim(),
    category: String(json.category ?? '').trim(),
    target_audience: String(json.target_audience ?? '').trim(),
    is_outbound_shop: Boolean(json.is_outbound_shop),
    has_sales_motion: Boolean(json.has_sales_motion),
  };
}

export function classifyFieldsComplete(result: ClassifyResult): boolean {
  return (
    Boolean(result.what_they_sell) &&
    Boolean(result.category) &&
    (result.primary_buyer === 'business' || result.primary_buyer === 'consumer') &&
    (result.customer_geo === 'local' ||
      result.customer_geo === 'regional' ||
      result.customer_geo === 'us' ||
      result.customer_geo === 'global')
  );
}

function heuristic(text: string): Partial<ClassifyResult> {
  const is_outbound_shop = OUTBOUND_SHOP_RE.test(text);
  const has_sales_motion = /\b(book a demo|talk to sales|request a demo|get a demo|sales team)\b/i.test(text);
  return { is_outbound_shop, has_sales_motion };
}

function fixtureClassify(companyId: string, domain: string | null): ClassifyResult | null {
  const path = join(fixturesDir, 'llm', 'classify.json');
  if (!existsSync(path)) return null;
  const map = JSON.parse(readFileSync(path, 'utf8')) as Record<string, ClassifyResult>;
  return map[companyId] ?? (domain ? map[domain] : undefined) ?? map.default ?? null;
}

export async function classifyCompany(
  ctx: PipelineContext,
  company: CompanyRecord,
  site: CrawledSite,
): Promise<ClassifyResult> {
  const text = combinedText(site);
  const heur = heuristic(text || `${company.name} ${company.industry}`);
  const request = { version: CLASSIFY_PROMPT_VERSION, domain: company.domain, name: company.name, textHash: text.slice(0, 200) };

  if (ctx.fixtures) {
    const fixed = fixtureClassify(company.company_id, company.domain) ?? {
      b2b_type: 'b2b',
      primary_buyer: 'business',
      customer_geo: 'us',
      what_they_sell: 'Unknown',
      category: company.industry || 'unknown',
      target_audience: '',
      is_outbound_shop: Boolean(heur.is_outbound_shop),
      has_sales_motion: Boolean(heur.has_sales_motion),
    };
    if (heur.is_outbound_shop) fixed.is_outbound_shop = true;
    writeCached(ctx.cacheRoot, 'openrouter-classify', request, fixed);
    return fixed;
  }

  const cached = readCached<ClassifyResult>(ctx.cacheRoot, 'openrouter-classify', request);
  if (cached && classifyFieldsComplete(cached.body)) return cached.body;

  if (!text) {
    const fallback: ClassifyResult = {
      b2b_type: 'unknown',
      primary_buyer: 'unknown',
      customer_geo: 'unknown',
      what_they_sell: company.industry || 'unknown',
      category: company.industry || 'unknown',
      target_audience: '',
      is_outbound_shop: Boolean(heur.is_outbound_shop),
      has_sales_motion: Boolean(heur.has_sales_motion),
    };
    writeCached(ctx.cacheRoot, 'openrouter-classify', request, fallback);
    return fallback;
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENROUTER_API_KEY required for live classify');
  let parsed = await callOpenRouterClassify(apiKey, company, text);
  if (!classifyFieldsComplete(parsed)) {
    parsed = await callOpenRouterClassify(apiKey, company, text);
  }
  if (!parsed.what_they_sell) parsed.what_they_sell = company.industry || 'unknown';
  if (!parsed.category) parsed.category = company.industry || 'unknown';
  if (heur.is_outbound_shop) parsed.is_outbound_shop = true;
  if (heur.has_sales_motion) parsed.has_sales_motion = true;
  writeCached(ctx.cacheRoot, 'openrouter-classify', request, parsed);
  return parsed;
}

async function callOpenRouterClassify(
  apiKey: string,
  company: CompanyRecord,
  text: string,
): Promise<ClassifyResult> {
  const model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `Company: ${company.name}\nDomain: ${company.domain}\nReturn what_they_sell, category, primary_buyer, and customer_geo.\n\n${text.slice(0, 12000)}`,
          },
        ],
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenRouter classify HTTP ${response.status} ${errText.slice(0, 240)}`);
  }
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return parseClassify(body.choices?.[0]?.message?.content ?? '{}');
}

export function applyClassify(company: CompanyRecord, result: ClassifyResult): void {
  company.b2b_type = result.b2b_type;
  company.primary_buyer = result.primary_buyer;
  company.customer_geo = result.customer_geo;
  company.what_they_sell = result.what_they_sell;
  company.category = result.category;
  company.target_audience = result.target_audience;
  company.is_outbound_shop = result.is_outbound_shop;
  company.has_sales_motion = result.has_sales_motion;
  company.provenance.b2b_type = { source: 'openrouter', cached_at: new Date().toISOString() };
}
