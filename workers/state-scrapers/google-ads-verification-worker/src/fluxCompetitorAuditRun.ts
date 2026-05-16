import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { placesSearchText } from '@furnace/google-places';
import { normalizeGoogleAdsSearchDomain } from '@furnace/registry-server';
import { runGoogleAdsTransparencyAuditSamples } from './transparencyLookup.js';
import fluxCompetitorAuditRank from '../../../../lib/flux/fluxCompetitorAuditRank';
import type { FluxCompetitorScoredDomain } from '../../../../lib/flux/fluxCompetitorAuditRank';
import fluxCompetitorAuditFailureMessage from '../../../../lib/flux/fluxCompetitorAuditFailureMessage';
import type { FluxAuditDomainResultRow } from '../../../../lib/flux/fluxCompetitorAuditFailureMessage';
import { workerJsonLog } from './workerJsonLog.js';

const REGION = 'US';
const PLACES_RADIUS_M = 20_000;
const MAX_TRANSPARENCY = 12;
const MIN_PLACES_SCANNED_BEFORE_EARLY_EXIT = 6;
const TARGET_OK_DOMAINS_FOR_EARLY_EXIT = 3;
const DOMAIN_TIMEOUT_MS = 300_000;
const BUCKET = 'flux-competitor-map';
const MAX_PUBLISHED_WINNERS = 3;
const MAX_PUBLISHED_SAMPLES_PER_WINNER = 2;

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

async function withAbortTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timeoutMessage = `${label}_timeout`;
  const timer = setTimeout(() => controller.abort(timeoutMessage), ms);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Supabase `StorageError` often omits `message`; never return an empty string (UI showed "Storage upload failed: <none>"). */
function describeSupabaseStorageError(err: unknown): string {
  if (err == null) return '(null)';
  if (typeof err === 'string') return err.trim() || '(empty string)';
  if (typeof err !== 'object') return String(err);
  const o = err as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['message', 'error', 'statusCode', 'status', 'name', 'code'] as const) {
    const v = o[key];
    if (v !== undefined && v !== null && String(v).trim().length > 0) {
      parts.push(`${key}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    }
  }
  try {
    const json = JSON.stringify(err, Object.getOwnPropertyNames(o));
    if (parts.length > 0) return `${parts.join('; ')} | ${json}`;
    return json.length > 2 ? json : '(object with no enumerable detail)';
  } catch {
    return parts.join('; ') || '(unserializable error object)';
  }
}

function adsSummaryFromAudit(creativeCount: number, latest: string | null): string {
  const datePart = latest && latest.trim() ? latest.trim() : 'unknown';
  return `~${creativeCount} ads in Google’s Transparency Center; most recent creative shown ${datePart}.`;
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

/** Log-safe description of the Static Map request (never includes the API key). */
function staticMapRequestMeta(lat: number, lng: number): Record<string, string | number> {
  return {
    endpoint: 'maps.googleapis.com/maps/api/staticmap',
    center_lat: lat,
    center_lng: lng,
    zoom: 14,
    size: '400x400',
    scale: 2,
    maptype: 'roadmap',
  };
}

export async function runFluxCompetitorAuditJob(params: {
  jobId: string;
  awsRegion: string;
}): Promise<boolean> {
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
    workerJsonLog('flux_competitor_audit_fail_job', {
      jobId: params.jobId,
      message: msg.slice(0, 2000),
      resultExtraKeys: resultExtra ? Object.keys(resultExtra) : [],
    });
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
          errorMessage: msg.slice(0, 12_000),
          lastAuditDomainReport: undefined,
          competitors: [],
        };
        await flux.from('flux_prospect_pages').update({ page_config: cfg as never }).eq('id', pageId);
      }
    }
    await flux
      .from('flux_async_jobs')
      .update({
        status: 'failed',
        error_message: msg.slice(0, 12_000),
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
      return false;
    }
    const cfg = (page.page_config ?? {}) as PageConfig;
    const blocks = Array.isArray(cfg.blocks) ? cfg.blocks : [];
    const block = blocks.find((b) => b && typeof b === 'object' && (b as { id?: string }).id === blockId) as
      | { type?: string; props?: Record<string, unknown> }
      | undefined;
    if (!block || block.type !== 'competitor_ad_audit') {
      await failJob('Block removed before audit finished');
      return false;
    }

    const { data: prospect, error: prErr } = await flux
      .from('flux_prospects')
      .select('industry, url, website_domain_key, service_area, company')
      .eq('id', page.prospect_id as string)
      .maybeSingle();
    if (prErr || !prospect) {
      await failJob(prErr?.message || 'Prospect not found');
      return false;
    }
    const sa = prospect.service_area as Record<string, unknown> | null;
    const lat = typeof sa?.latitude === 'number' ? sa.latitude : Number(sa?.latitude);
    const lng = typeof sa?.longitude === 'number' ? sa.longitude : Number(sa?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      await failJob('Prospect service area (latitude/longitude) is required.');
      return false;
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
      return false;
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
    let attemptedPlacesCount = 0;
    let okDomainCount = 0;
    let placesStopReason: 'min_reached_and_enough_ok' | 'max_reached' | 'exhausted_candidates' | null = null;

    for (let ci = 0; ci < candidates.length; ci += 1) {
      const c = candidates[ci]!;
      const row: FluxAuditDomainResultRow = {
        domain: c.domain,
        outcome: 'ok',
        creative_count: null,
        message: undefined,
      };
      const domainWallStart = Date.now();
      try {
        const audit = await withAbortTimeout(
          (signal) =>
            runGoogleAdsTransparencyAuditSamples({
            domain: c.domain,
            headless: true,
            region: REGION,
            timeoutMs: 50_000,
            maxSamples: MAX_PUBLISHED_SAMPLES_PER_WINNER,
            jobId: params.jobId,
            signal,
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
          okDomainCount += 1;
          scored.push({
            domain: c.domain,
            placeIndex: c.placeIndex,
            creativeCount: audit.creativeCount,
            latestAdLastShownAt: audit.latestAdLastShownAt,
            distanceMeters: fluxCompetitorAuditRank.haversineDistanceMeters(lat, lng, c.lat, c.lng),
            longestAdRunDays: audit.longestAdRunDays ?? null,
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
      attemptedPlacesCount += 1;
      workerJsonLog('transparency_domain_audit_wall_ms', {
        jobId: params.jobId,
        domain: c.domain,
        wallMs: Date.now() - domainWallStart,
        outcome: row.outcome,
        creativeCount: row.creative_count ?? null,
        message: row.message?.slice(0, 200) ?? null,
        attemptedPlacesCount,
        okDomainCount,
      });
      auditRows.push(row);
      await flux
        .from('flux_async_jobs')
        .update({ result: { audit_domains: auditRows } as never })
        .eq('id', params.jobId);

      if (
        attemptedPlacesCount >= MIN_PLACES_SCANNED_BEFORE_EARLY_EXIT &&
        okDomainCount >= TARGET_OK_DOMAINS_FOR_EARLY_EXIT &&
        ci + 1 < candidates.length
      ) {
        placesStopReason = 'min_reached_and_enough_ok';
        break;
      }
    }

    if (!placesStopReason) {
      placesStopReason =
        candidates.length >= MAX_TRANSPARENCY && attemptedPlacesCount >= candidates.length
          ? 'max_reached'
          : 'exhausted_candidates';
    }

    const ranked = fluxCompetitorAuditRank.rankFluxCompetitorDomains(scored);
    const winners = ranked.slice(0, MAX_PUBLISHED_WINNERS);
    if (winners.length < 1) {
      await failJob(fluxCompetitorAuditFailureMessage.buildFluxCompetitorAuditFailureMessage(auditRows), {
        ranked_count: 0,
        attempted_places_count: attemptedPlacesCount,
        ok_domain_count: okDomainCount,
        places_stop_reason: placesStopReason,
      });
      return false;
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
        let bodyPreview = '';
        try {
          bodyPreview = (await mapRes.text()).slice(0, 8000);
        } catch (readErr) {
          bodyPreview = readErr instanceof Error ? readErr.message : 'unknown_read_error';
        }
        const contentType = mapRes.headers.get('content-type');
        workerJsonLog('static_map_fetch_failed', {
          jobId: params.jobId,
          domain: w.domain,
          winnerIndex: wi,
          httpStatus: mapRes.status,
          httpStatusText: mapRes.statusText,
          contentType,
          request: staticMapRequestMeta(clat, clng),
          responseBodyPreview: bodyPreview.slice(0, 4000),
        });
        await failJob(`Static map fetch failed (${mapRes.status}) for ${w.domain}`, {
          static_map_fetch: {
            status: mapRes.status,
            statusText: mapRes.statusText,
            content_type: contentType,
            body_preview: bodyPreview.slice(0, 4000),
            domain: w.domain,
            winner_index: wi,
            center_lat: clat,
            center_lng: clng,
          },
        });
        return false;
      }
      const buf = Buffer.from(await mapRes.arrayBuffer());
      const path = `${accountId}/${pageId}/${blockId}/map-${wi}.png`;
      const { data: uploadData, error: upErr } = await flux.storage.from(BUCKET).upload(path, buf, {
        contentType: 'image/png',
        upsert: true,
      });
      if (upErr) {
        const detail = describeSupabaseStorageError(upErr);
        workerJsonLog('storage_upload_failed', {
          jobId: params.jobId,
          bucket: BUCKET,
          objectPath: path,
          byteLength: buf.length,
          detail,
          uploadData:
            uploadData == null
              ? null
              : typeof uploadData === 'object'
                ? JSON.stringify(uploadData)
                : String(uploadData),
        });
        await failJob(`Storage upload failed: ${detail}`, {
          storage_upload: { bucket: BUCKET, path, byte_length: buf.length, detail },
        });
        return false;
      }
      const pub = flux.storage.from(BUCKET).getPublicUrl(path);
      const publicUrl = pub.data.publicUrl;

      const audit = auditByDomain.get(w.domain);
      if (!audit || audit.outcome !== 'ok') {
        await failJob(`Missing audit data for winner ${w.domain}`);
        return false;
      }
      const samples = audit.samples.slice(0, MAX_PUBLISHED_SAMPLES_PER_WINNER);
      const examples: Array<{ headline: string; body: string; sourceUrl: string; imageUrl?: string }> = [];
      for (let j = 0; j < samples.length; j += 1) {
        const s = samples[j];
        const headline = (s.headline || s.body.slice(0, 80) || 'Ad creative').slice(0, 200);
        const body = s.body.slice(0, 400);
        const sourceUrl = s.sourceUrl;
        let imageUrl: string | undefined;
        const preview = s.previewPng;
        const uploadBuf =
          preview && preview.length > 0
            ? Buffer.isBuffer(preview)
              ? preview
              : Buffer.from(preview)
            : null;
        if (uploadBuf) {
          const creativePath = `${accountId}/${pageId}/${blockId}/creative-${wi}-${j}.png`;
          const { data: creativeUploadData, error: creativeUpErr } = await flux.storage
            .from(BUCKET)
            .upload(creativePath, uploadBuf, { contentType: 'image/png', upsert: true });
          if (creativeUpErr) {
            workerJsonLog('creative_preview_upload_failed', {
              jobId: params.jobId,
              bucket: BUCKET,
              objectPath: creativePath,
              byteLength: uploadBuf.length,
              domain: w.domain,
              winnerIndex: wi,
              sampleIndex: j,
              detail: describeSupabaseStorageError(creativeUpErr),
              uploadData:
                creativeUploadData == null
                  ? null
                  : typeof creativeUploadData === 'object'
                    ? JSON.stringify(creativeUploadData)
                    : String(creativeUploadData),
            });
          } else {
            imageUrl = flux.storage.from(BUCKET).getPublicUrl(creativePath).data.publicUrl;
          }
        } else {
          workerJsonLog('creative_preview_skipped_no_png', {
            jobId: params.jobId,
            domain: w.domain,
            winnerIndex: wi,
            sampleIndex: j,
            hadPreviewField: preview != null,
            previewByteLength: preview && typeof preview.length === 'number' ? preview.length : 0,
            sourceUrl: sourceUrl.slice(0, 200),
          });
        }
        workerJsonLog('creative_preview_publish_result', {
          jobId: params.jobId,
          domain: w.domain,
          winnerIndex: wi,
          sampleIndex: j,
          sourceUrl: sourceUrl.slice(0, 200),
          hadPreviewField: preview != null,
          previewByteLength: preview && typeof preview.length === 'number' ? preview.length : 0,
          uploadAttempted: uploadBuf != null,
          uploadSucceeded: Boolean(imageUrl),
          finalHasImageUrl: Boolean(imageUrl),
        });
        examples.push({ headline, body, sourceUrl, ...(imageUrl ? { imageUrl } : {}) });
      }
      competitorRows.push({
        name,
        mapImageUrl: publicUrl,
        adsSummary: adsSummaryFromAudit(audit.creativeCount, audit.latestAdLastShownAt).slice(0, 320),
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
          lastAuditDomainReport: undefined,
          competitors: competitorRows,
        },
      };
    });

    const { error: updatePageErr } = await flux
      .from('flux_prospect_pages')
      .update({ page_config: { ...cfg, blocks: nextBlocks } as never })
      .eq('id', pageId);
    if (updatePageErr) {
      throw new Error(`Failed to persist completed competitor audit: ${updatePageErr.message}`);
    }

    const { error: updateJobErr } = await flux
      .from('flux_async_jobs')
      .update({
        status: 'succeeded',
        finished_at: new Date().toISOString(),
        error_message: null,
        result: { audit_domains: auditRows } as never,
      })
      .eq('id', params.jobId);
    if (updateJobErr) {
      throw new Error(`Failed to persist competitor audit job success: ${updateJobErr.message}`);
    }

    const outcomeCounts: Record<string, number> = {};
    for (const r of auditRows) {
      const k = r.outcome ?? 'unknown';
      outcomeCounts[k] = (outcomeCounts[k] ?? 0) + 1;
    }
    workerJsonLog('flux_competitor_audit_succeeded', {
      jobId: params.jobId,
      placesCandidateCount: candidates.length,
      attemptedPlacesCount,
      okDomainCount,
      placesStopReason,
      transparencyScoredOkCount: scored.length,
      publishedWinnerCount: winners.length,
      winnerDomains: winners.map((x) => x.domain),
      auditOutcomeCounts: outcomeCounts,
    });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await failJob(msg);
    return false;
  }
}
