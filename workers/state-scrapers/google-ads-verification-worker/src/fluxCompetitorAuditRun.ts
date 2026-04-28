import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { placesSearchText } from '@furnace/google-places';
import { normalizeGoogleAdsSearchDomain } from '@furnace/registry-server';
import {
  runGoogleAdsTransparencyAuditSamples,
  type TransparencyCreativeSampleRow,
} from './transparencyLookup.js';
import { rankFluxCompetitorDomains, type FluxCompetitorScoredDomain } from '../../../../lib/flux/fluxCompetitorAuditRank';
import {
  buildFluxCompetitorAuditFailureMessage,
  type FluxAuditDomainResultRow,
} from '../../../../lib/flux/fluxCompetitorAuditFailureMessage';

const REGION = 'US';
const PLACES_RADIUS_M = 20_000;
const MAX_TRANSPARENCY = 12;
const DOMAIN_TIMEOUT_MS = 120_000;
const BUCKET = 'flux-competitor-map';

type PageConfig = { blocks: Array<Record<string, unknown>>; [k: string]: unknown };

async function fetchSsm(paramPath: string, region: string): Promise<string> {
  const client = new SSMClient({ region });
  const res = await client.send(new GetParameterCommand({ Name: paramPath, WithDecryption: true }));
  const v = res.Parameter?.Value?.trim();
  if (!v) throw new Error(`SSM ${paramPath} empty`);
  return v;
}

function hostFromUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(raw.trim().startsWith('http') ? raw.trim() : `https://${raw.trim()}`);
    return u.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function hostFromWebsiteUri(uri: string | null | undefined): string | null {
  if (!uri?.trim()) return null;
  return hostFromUrl(uri);
}

function etldPlusOne(host: string): string {
  const parts = host.split('.').filter(Boolean);
  if (parts.length >= 2) return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  return host;
}

type GooglePlaceRow = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
};

function parsePlacesSearchBody(json: unknown): GooglePlaceRow[] {
  if (!json || typeof json !== 'object') return [];
  const places = (json as { places?: unknown }).places;
  if (!Array.isArray(places)) return [];
  return places as GooglePlaceRow[];
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
    }),
  ]);
}

function adsSummaryFromAudit(
  creativeCount: number,
  latest: string | null,
  firstSample?: TransparencyCreativeSampleRow,
): string {
  const datePart = latest && latest.trim() ? latest.trim() : 'unknown';
  const base = `~${creativeCount} ads in Google’s Transparency Center; most recent creative shown ${datePart}.`;
  if (firstSample?.headline?.trim()) {
    return `${base} Sample: ${firstSample.headline.trim().slice(0, 140)}`;
  }
  return base;
}

function staticMapUrl(lat: number, lng: number, apiKey: string): string {
  const q = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: '14',
    size: '400x400',
    scale: '2',
    maptype: 'roadmap',
    markers: `color:red|${lat},${lng}`,
    key: apiKey,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${q.toString()}`;
}

export async function runFluxCompetitorAuditJob(params: {
  jobId: string;
  awsRegion: string;
}): Promise<void> {
  const awsRegion = params.awsRegion || process.env.AWS_REGION || 'us-west-2';
  const fluxUrl = process.env.FLUX_SUPABASE_URL?.trim();
  const fluxKeyPath = process.env.FLUX_SUPABASE_SECRET_KEY_PARAM_PATH?.trim();
  const placesKeyPath = process.env.GOOGLE_PLACES_API_KEY_PARAM_PATH?.trim();
  const placesKeyDirect = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!fluxUrl || !fluxKeyPath) {
    throw new Error('Missing FLUX_SUPABASE_URL or FLUX_SUPABASE_SECRET_KEY_PARAM_PATH');
  }
  const fluxKey = await fetchSsm(fluxKeyPath, awsRegion);
  const flux: SupabaseClient = createClient(fluxUrl, fluxKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let googlePlacesKey = placesKeyDirect ?? '';
  if (!googlePlacesKey && placesKeyPath) {
    googlePlacesKey = await fetchSsm(placesKeyPath, awsRegion);
  }
  if (!googlePlacesKey) {
    throw new Error('Missing GOOGLE_PLACES_API_KEY or GOOGLE_PLACES_API_KEY_PARAM_PATH');
  }

  const { data: jobRow, error: jobErr } = await flux
    .from('flux_async_jobs')
    .select('*')
    .eq('id', params.jobId)
    .eq('job_type', 'competitor_ad_audit')
    .maybeSingle();
  if (jobErr || !jobRow) throw new Error(jobErr?.message || `flux_async_jobs ${params.jobId} not found`);

  const pageId = jobRow.subject_id as string;
  const payload = (jobRow.payload ?? {}) as { block_id?: string };
  const blockId = typeof payload.block_id === 'string' ? payload.block_id.trim() : '';
  if (!blockId) throw new Error('payload.block_id missing');

  await flux
    .from('flux_async_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', params.jobId);

  const auditRows: FluxAuditDomainResultRow[] = [];

  const failJob = async (msg: string, resultExtra?: Record<string, unknown>) => {
    const { data: page } = await flux.from('flux_prospect_pages').select('page_config').eq('id', pageId).maybeSingle();
    const cfg = (page?.page_config ?? {}) as PageConfig;
    const blocks = Array.isArray(cfg.blocks) ? [...cfg.blocks] : [];
    const ix = blocks.findIndex((b) => b && typeof b === 'object' && (b as { id?: string }).id === blockId);
    if (ix >= 0) {
      const b = blocks[ix] as { type?: string; props?: Record<string, unknown> };
      if (b.type === 'competitor_ad_audit') {
        b.props = {
          ...(typeof b.props === 'object' && b.props ? b.props : {}),
          heading: typeof b.props?.heading === 'string' ? b.props.heading : 'Competitor ad audit',
          status: 'error',
          errorMessage: msg.slice(0, 500),
          competitors: [],
        };
        await flux.from('flux_prospect_pages').update({ page_config: cfg as never }).eq('id', pageId);
      }
    }
    await flux
      .from('flux_async_jobs')
      .update({
        status: 'failed',
        error_message: msg.slice(0, 500),
        finished_at: new Date().toISOString(),
        result: { audit_domains: auditRows, ...(resultExtra ?? {}) } as never,
      })
      .eq('id', params.jobId);
  };

  try {
    const { data: page, error: pageErr } = await flux
      .from('flux_prospect_pages')
      .select('page_config, prospect_id, account_id')
      .eq('id', pageId)
      .maybeSingle();
    if (pageErr || !page) {
      await failJob(pageErr?.message || 'Page not found');
      return;
    }
    const cfg = (page.page_config ?? {}) as PageConfig;
    const blocks = Array.isArray(cfg.blocks) ? cfg.blocks : [];
    const block = blocks.find((b) => b && typeof b === 'object' && (b as { id?: string }).id === blockId) as
      | { type?: string; props?: Record<string, unknown> }
      | undefined;
    if (!block || block.type !== 'competitor_ad_audit') {
      await failJob('Block removed before audit finished');
      return;
    }

    const { data: prospect, error: prErr } = await flux
      .from('flux_prospects')
      .select('industry, url, website_domain_key, service_area, company')
      .eq('id', page.prospect_id as string)
      .maybeSingle();
    if (prErr || !prospect) {
      await failJob(prErr?.message || 'Prospect not found');
      return;
    }
    const sa = prospect.service_area as Record<string, unknown> | null;
    const lat = typeof sa?.latitude === 'number' ? sa.latitude : Number(sa?.latitude);
    const lng = typeof sa?.longitude === 'number' ? sa.longitude : Number(sa?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      await failJob('Prospect service area (latitude/longitude) is required.');
      return;
    }

    const industry = typeof prospect.industry === 'string' ? prospect.industry.trim() : '';
    const textQuery = industry.length >= 3 ? industry : 'local services';
    const placesRes = await placesSearchText(googlePlacesKey, {
      textQuery,
      languageCode: 'en-US',
      maxResultCount: 20,
      locationBias: { latitude: lat, longitude: lng, radiusMeters: PLACES_RADIUS_M },
    });
    if (!placesRes.ok) {
      await failJob(placesRes.message || 'Places search failed');
      return;
    }
    const placeList = parsePlacesSearchBody(placesRes.json);
    const prospectDomains = new Set<string>();
    const pk = normalizeGoogleAdsSearchDomain(
      typeof prospect.website_domain_key === 'string' ? prospect.website_domain_key : '',
    );
    if (pk) prospectDomains.add(pk);
    const uh = hostFromUrl(typeof prospect.url === 'string' ? prospect.url : null);
    if (uh) {
      const nd = normalizeGoogleAdsSearchDomain(uh.replace(/^www\./, ''));
      if (nd) prospectDomains.add(nd);
    }

    type Cand = { domain: string; name: string; lat: number; lng: number; placeIndex: number };
    const candidates: Cand[] = [];
    const seenEtld = new Set<string>();
    let idx = 0;
    for (const p of placeList) {
      const web = typeof p.websiteUri === 'string' ? p.websiteUri : '';
      const dom = normalizeGoogleAdsSearchDomain(hostFromWebsiteUri(web) ?? '');
      if (!dom) {
        idx += 1;
        continue;
      }
      if (prospectDomains.has(dom)) {
        idx += 1;
        continue;
      }
      const dedupeKey = etldPlusOne(dom);
      if (seenEtld.has(dedupeKey)) {
        idx += 1;
        continue;
      }
      seenEtld.add(dedupeKey);
      const name = (p.displayName as { text?: string } | undefined)?.text?.trim() || dom;
      const plat = p.location?.latitude;
      const plng = p.location?.longitude;
      if (!Number.isFinite(plat) || !Number.isFinite(plng)) {
        idx += 1;
        continue;
      }
      candidates.push({ domain: dom, name, lat: plat as number, lng: plng as number, placeIndex: idx });
      idx += 1;
      if (candidates.length >= MAX_TRANSPARENCY) break;
    }

    const scored: FluxCompetitorScoredDomain[] = [];
    type AuditOk = Awaited<ReturnType<typeof runGoogleAdsTransparencyAuditSamples>>;
    const auditByDomain = new Map<string, AuditOk>();

    for (const c of candidates) {
      const row: FluxAuditDomainResultRow = {
        domain: c.domain,
        outcome: 'ok',
        creative_count: null,
        message: undefined,
      };
      try {
        const audit = await withTimeout(
          runGoogleAdsTransparencyAuditSamples({
            domain: c.domain,
            headless: true,
            region: REGION,
            timeoutMs: 25_000,
            maxSamples: 2,
          }),
          DOMAIN_TIMEOUT_MS,
          `transparency_${c.domain}`,
        );
        if (audit.outcome === 'transparency_no_match') {
          row.outcome = 'transparency_no_match';
          row.message = 'No Transparency match';
        } else if (audit.outcome === 'transparency_zero_creatives') {
          row.outcome = 'transparency_zero_creatives';
          row.message = 'Zero creatives';
        } else if (audit.outcome === 'playwright_error') {
          row.outcome = 'playwright_error';
          row.message = audit.message ?? 'playwright_error';
        } else if (audit.outcome === 'ok' && audit.creativeCount > 0) {
          row.outcome = 'ok';
          row.creative_count = audit.creativeCount;
          auditByDomain.set(c.domain, audit);
          scored.push({
            domain: c.domain,
            placeIndex: c.placeIndex,
            creativeCount: audit.creativeCount,
            latestAdLastShownAt: audit.latestAdLastShownAt,
          });
        } else {
          row.outcome = 'transparency_zero_creatives';
          row.message = 'No creative hrefs';
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.endsWith('_timeout')) {
          row.outcome = 'timeout';
          row.message = msg;
        } else {
          row.outcome = 'playwright_error';
          row.message = msg.slice(0, 200);
        }
      }
      auditRows.push(row);
      await flux
        .from('flux_async_jobs')
        .update({ result: { audit_domains: auditRows } as never })
        .eq('id', params.jobId);
    }

    const ranked = rankFluxCompetitorDomains(scored);
    const winners = ranked.slice(0, 3);
    if (winners.length < 3) {
      await failJob(buildFluxCompetitorAuditFailureMessage(auditRows), { ranked_count: winners.length });
      return;
    }

    const accountId = page.account_id as string;
    const competitorRows: Array<{
      name: string;
      mapImageUrl: string;
      adsSummary: string;
      examples: Array<{ headline: string; body: string; sourceUrl: string; imageUrl?: string }>;
    }> = [];

    for (let wi = 0; wi < winners.length; wi += 1) {
      const w = winners[wi];
      const cand = candidates.find((x) => x.domain === w.domain);
      const name = cand?.name ?? w.domain;
      const clat = cand?.lat ?? lat;
      const clng = cand?.lng ?? lng;
      const mapUrl = staticMapUrl(clat, clng, googlePlacesKey);
      const mapRes = await fetch(mapUrl);
      if (!mapRes.ok) {
        await failJob(`Static map fetch failed (${mapRes.status}) for ${w.domain}`);
        return;
      }
      const buf = Buffer.from(await mapRes.arrayBuffer());
      const path = `${accountId}/${pageId}/${blockId}/map-${wi}.png`;
      const { error: upErr } = await flux.storage.from(BUCKET).upload(path, buf, {
        contentType: 'image/png',
        upsert: true,
      });
      if (upErr) {
        await failJob(`Storage upload failed: ${upErr.message}`);
        return;
      }
      const pub = flux.storage.from(BUCKET).getPublicUrl(path);
      const publicUrl = pub.data.publicUrl;

      const audit = auditByDomain.get(w.domain);
      if (!audit || audit.outcome !== 'ok') {
        await failJob(`Missing audit data for winner ${w.domain}`);
        return;
      }
      let samples = audit.samples.slice(0, 2);
      if (samples.length === 1) {
        samples = [...samples, samples[0]];
      }
      const examples = samples.map((s) => ({
        headline: (s.headline || s.body.slice(0, 80) || 'Ad creative').slice(0, 200),
        body: s.body.slice(0, 400),
        sourceUrl: s.sourceUrl,
      }));
      competitorRows.push({
        name,
        mapImageUrl: publicUrl,
        adsSummary: adsSummaryFromAudit(audit.creativeCount, audit.latestAdLastShownAt, audit.samples[0]).slice(
          0,
          320,
        ),
        examples,
      });

      for (const r of auditRows) {
        if (r.domain === w.domain && r.outcome === 'ok') {
          (r as FluxAuditDomainResultRow & { selected_rank?: number }).selected_rank = wi + 1;
        }
      }
    }

    const nextBlocks = blocks.map((b) => {
      if (!b || typeof b !== 'object' || (b as { id?: string }).id !== blockId) return b;
      const o = b as { type?: string; props?: Record<string, unknown> };
      if (o.type !== 'competitor_ad_audit') return b;
      return {
        ...o,
        props: {
          ...(typeof o.props === 'object' && o.props ? o.props : {}),
          heading: typeof o.props?.heading === 'string' ? o.props.heading : 'Competitor ad audit',
          status: 'ready',
          errorMessage: undefined,
          lastAuditAt: new Date().toISOString(),
          competitors: competitorRows,
        },
      };
    });

    await flux
      .from('flux_prospect_pages')
      .update({ page_config: { ...cfg, blocks: nextBlocks } as never })
      .eq('id', pageId);

    await flux
      .from('flux_async_jobs')
      .update({
        status: 'succeeded',
        finished_at: new Date().toISOString(),
        error_message: null,
        result: { audit_domains: auditRows } as never,
      })
      .eq('id', params.jobId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await failJob(msg);
  }
}
