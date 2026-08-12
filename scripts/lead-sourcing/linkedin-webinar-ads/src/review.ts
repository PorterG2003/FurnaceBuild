import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeText } from './io.js';
import { applyReviewDecisions, normalizeAndFilter } from './pipeline.js';
import { DEFAULT_CONFIG } from './config.js';
import type { NormalizedAd, RawAd, ReviewDecision } from './types.js';

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function card(ad: NormalizedAd): string {
  const id = htmlEscape(ad.dedupeKey);
  const copy = htmlEscape(ad.primaryText ?? '');
  const reasons = htmlEscape(ad.exclusionReasons.join(', ') || 'none');
  const signals = htmlEscape(ad.liveSignals.join(', ') || 'none');
  const landing = ad.landingUrl ? `<span class="url">${htmlEscape(ad.landingUrl)}</span>` : '<span class="missing">No landing URL exposed</span>';
  const creativeImageUrls = ad.creativeImageUrls ?? [];
  const images = creativeImageUrls.length
    ? `<div class="images">${creativeImageUrls.map((url) => `<img src="${htmlEscape(url)}" alt="Ad creative" loading="lazy">`).join('')}</div>`
    : '';
  return `<article class="card" data-id="${id}" data-auto="${ad.disposition}">
  <header><strong>${htmlEscape(ad.advertiserName ?? 'Unknown advertiser')}</strong><span>${htmlEscape(ad.adId ?? 'No ad ID')}</span></header>
  ${images}<p class="copy">${copy || '<em>No copy extracted</em>'}</p>
  <dl><dt>Auto decision</dt><dd class="auto">${htmlEscape(ad.disposition)}</dd><dt>Signals</dt><dd>${signals}</dd><dt>Reasons</dt><dd>${reasons}</dd><dt>Landing</dt><dd>${landing}</dd></dl>
  <div class="actions"><button data-decision="keep">Keep</button><button data-decision="exclude">Exclude</button><button data-decision="review">Needs review</button></div>
  <label>Note <input type="text" placeholder="Why? (optional)" /></label>
</article>`;
}

export function buildReviewHtml(ads: NormalizedAd[], initialDecisions: ReviewDecision[] = []): string {
  const payload = JSON.stringify(ads.map((ad) => ({ adId: ad.adId, dedupeKey: ad.dedupeKey }))).replace(/</g, '\\u003c');
  const decisionsPayload = JSON.stringify(initialDecisions).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>LinkedIn webinar ad review</title>
<style>body{font:15px system-ui;margin:24px;background:#f6f7f8;color:#18212b}header{display:flex;justify-content:space-between;gap:12px}.toolbar{position:sticky;top:0;background:#f6f7f8;padding:12px 0;display:flex;gap:8px;align-items:center}.card{background:white;border:1px solid #dbe0e6;border-radius:8px;padding:16px;margin:12px 0}.card[data-current="keep"]{border-left:5px solid #16803d}.card[data-current="exclude"]{border-left:5px solid #ba2626}.card[data-current="review"]{border-left:5px solid #a15c00}.copy{white-space:pre-wrap;line-height:1.45}dl{display:grid;grid-template-columns:110px 1fr;gap:6px;margin:12px 0}dt{font-weight:600}.url{word-break:break-all}.missing{color:#697386}.images{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.images img{max-width:min(360px,100%);max-height:280px;object-fit:contain;border:1px solid #dbe0e6;border-radius:4px}.actions{display:flex;gap:8px;margin:10px 0}button{padding:7px 12px;border:1px solid #aeb7c2;border-radius:5px;background:white;cursor:pointer}button[data-decision="keep"]{color:#086d2d}button[data-decision="exclude"]{color:#a31d1d}input{width:min(600px,90%)}.hidden{display:none}</style></head><body>
<h1>LinkedIn webinar ad review</h1><p>Review without opening LinkedIn. “Keep” overrides the current filter; “Exclude” blocks it; “Needs review” keeps it out of exports pending a decision.</p>
<div class="toolbar"><button id="show-review">Needs review</button><button id="show-qualified">Qualified</button><button id="show-auto-excluded">Excluded</button><button id="show-all">All</button><button id="show-changed">Manual decisions</button><button id="download">Download decisions</button><span id="count"></span></div>
<main>${ads.map(card).join('\n')}</main><script>const ads=${payload};const initial=${decisionsPayload};const state=new Map(initial.map(decision=>[decision.dedupeKey,decision]));const cards=[...document.querySelectorAll('.card')];const count=document.querySelector('#count');
function render(){let visible=0;cards.forEach(card=>{const entry=state.get(card.dataset.id);const current=entry?.decision;const effective=current||card.dataset.auto;card.dataset.current=effective||'';const note=card.querySelector('input');if(note&&note.value!==(entry?.note||''))note.value=entry?.note||'';const mode=document.body.dataset.mode||'review';const show=mode==='all'||(mode==='review'&&effective==='review')||(mode==='qualified'&&effective==='qualified')||(mode==='auto-excluded'&&effective==='excluded')||(mode==='changed'&&current&&current!=='review');card.classList.toggle('hidden',!show);if(show)visible++});count.textContent=visible+' shown';}
document.querySelectorAll('[data-decision]').forEach(button=>button.onclick=()=>{const card=button.closest('.card');state.set(card.dataset.id,{decision:button.dataset.decision,note:card.querySelector('input').value});render()});
document.querySelector('#show-review').onclick=()=>{document.body.dataset.mode='review';render()};document.querySelector('#show-qualified').onclick=()=>{document.body.dataset.mode='qualified';render()};document.querySelector('#show-all').onclick=()=>{document.body.dataset.mode='all';render()};document.querySelector('#show-auto-excluded').onclick=()=>{document.body.dataset.mode='auto-excluded';render()};document.querySelector('#show-changed').onclick=()=>{document.body.dataset.mode='changed';render()};
document.querySelector('#download').onclick=()=>{const decisions=ads.flatMap(ad=>{const change=state.get(ad.dedupeKey);return change?[{...ad,...change}]:[]});const blob=new Blob([JSON.stringify({version:1,decisions},null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='review-decisions.json';link.click();URL.revokeObjectURL(link.href)};render();</script></body></html>`;
}

function main(): void {
  const runIndex = process.argv.indexOf('--run-dir');
  if (runIndex < 0 || !process.argv[runIndex + 1]) throw new Error('Usage: review --run-dir <run directory>');
  const runDir = resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[runIndex + 1]!);
  const checkpoint = JSON.parse(readFileSync(join(runDir, 'checkpoint.json'), 'utf8')) as { rawAds: RawAd[] };
  const decisionPath = join(runDir, 'review-decisions.applied.json');
  const decisions = existsSync(decisionPath)
    ? (JSON.parse(readFileSync(decisionPath, 'utf8')) as { decisions: ReviewDecision[] }).decisions
    : [];
  const ads = applyReviewDecisions(normalizeAndFilter(checkpoint.rawAds, DEFAULT_CONFIG), decisions);
  writeText(join(runDir, 'review.html'), buildReviewHtml(ads, decisions));
  console.log(join(runDir, 'review.html'));
}

main();
