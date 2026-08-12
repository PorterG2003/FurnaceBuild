import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, readCsv, writeCsv, writeJson, writeText } from './io.js';
import { looksLikePersonName } from './landingPeople.js';
import { normalizeDomain } from './types.js';

export const PASS8_ELIGIBLE_COLUMNS = [
  'ad_id',
  'platform',
  'company_name',
  'company_domain',
  'person_name_hint',
  'landing_url',
  'scrape_url',
  'ad_library_url',
  'ad_headline',
] as const;

function scrapeUrlFor(row: Record<string, string>): string {
  const landing = (row.landing_url || '').trim();
  if (landing && /^https?:\/\//i.test(landing)) return landing;
  const domain = normalizeDomain(row.company_domain || row.landing_domain || '');
  if (domain) return `https://${domain}/`;
  return '';
}

export function prepPass8(options: {
  pass1Dir: string;
  pass8Dir: string;
}): { eligible: number; csvPath: string } {
  const pass8Dir = ensureDir(options.pass8Dir);
  const darkPath = join(options.pass1Dir, 'pass5', 'dark_advertisers.csv');
  if (!existsSync(darkPath)) {
    throw new Error(`Missing ${darkPath} — run pass5 --stage prep first`);
  }

  const eligible: Record<string, string>[] = [];
  for (const row of readCsv(darkPath)) {
    const scrape_url = scrapeUrlFor(row);
    if (!scrape_url) continue;
    eligible.push({
      ad_id: row.ad_id || '',
      platform: row.platform || '',
      company_name: row.company_name || '',
      company_domain: normalizeDomain(row.company_domain || '') || '',
      person_name_hint: row.person_name || '',
      landing_url: row.landing_url || '',
      scrape_url,
      ad_library_url: row.ad_library_url || '',
      ad_headline: row.ad_headline || '',
    });
  }

  const csvPath = join(pass8Dir, 'eligible.csv');
  writeCsv(csvPath, eligible, [...PASS8_ELIGIBLE_COLUMNS]);
  writeJson(join(pass8Dir, 'prep_tally.json'), { eligible: eligible.length });
  console.log(JSON.stringify({ done: true, stage: 'prep', eligible: eligible.length }, null, 2));
  return { eligible: eligible.length, csvPath };
}

export function buildPass8ReviewHtml(pass8Dir: string): string {
  const profilesPath = join(pass8Dir, 'linkedin_profiles.csv');
  const candidatesPath = join(pass8Dir, 'linkedin_candidates.csv');
  const peoplePath = join(pass8Dir, 'landing_people.csv');

  const profiles = existsSync(profilesPath) ? readCsv(profilesPath) : [];
  const candidates = existsSync(candidatesPath) ? readCsv(candidatesPath) : [];
  const people = existsSync(peoplePath) ? readCsv(peoplePath) : [];

  const peopleByAd = new Map<string, Record<string, string>[]>();
  for (const p of people.filter((r) => r.status === 'found' && r.person_name)) {
    const list = peopleByAd.get(p.ad_id) || [];
    list.push(p);
    peopleByAd.set(p.ad_id, list);
  }

  // Prefer profile rows; else candidates
  const byAd = new Map<string, Record<string, string>>();
  for (const c of candidates) {
    if (!c.ad_id || !(c.linkedin_url || '').trim()) continue;
    if (!byAd.has(c.ad_id)) byAd.set(c.ad_id, { ...c });
  }
  for (const p of profiles) {
    if (!p.ad_id || !(p.linkedin_url || '').trim()) continue;
    const prev = byAd.get(p.ad_id);
    byAd.set(p.ad_id, { ...(prev || {}), ...p });
  }

  const items = [...byAd.values()].map((r) => {
    const related = peopleByAd.get(r.ad_id) || [];
    return {
      ad_id: r.ad_id,
      platform: r.platform || '',
      company_name: r.company_name || '',
      company_domain: r.company_domain || '',
      person_name: r.person_name || '',
      linkedin_url: r.linkedin_url || '',
      headline: r.headline || r.serper_title || '',
      company: r.company || '',
      profile_source: r.profile_source || '',
      evidence: related.map((p) => p.evidence).filter(Boolean).slice(0, 3).join(' · '),
      landing_people: related.map((p) => p.person_name).join(', '),
      landing_url: r.landing_url || related[0]?.landing_url || '',
      ad_library_url: r.ad_library_url || '',
      status: r.status || '',
    };
  });

  items.sort((a, b) => a.company_name.localeCompare(b.company_name));

  const itemsJson = JSON.stringify(items);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Pass 8 · Landing hosts → LinkedIn</title>
<style>
  :root { --bg:#f3efe6; --ink:#1c1917; --muted:#6b645b; --card:#fffdf8; --line:#e4dccf; --ok:#166534; --skip:#57534e; }
  * { box-sizing:border-box; }
  body { margin:0; color:var(--ink); font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;
    background: radial-gradient(900px 500px at 0% 0%, #e7dfd0, transparent 60%), var(--bg); }
  header { padding:20px 24px 8px; max-width:920px; margin:0 auto; }
  h1 { font-size:1.4rem; margin:0 0 6px; }
  .sub { color:var(--muted); font-size:0.92rem; }
  #stats { max-width:920px; margin:0 auto 12px; padding:0 24px; color:var(--muted); font-size:0.9rem; }
  .card { max-width:920px; margin:0 auto 14px; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
  .card h2 { margin:0 0 8px; font-size:1.1rem; }
  .meta { font-size:0.88rem; color:var(--muted); margin-bottom:8px; }
  .meta a { color:#1d4ed8; }
  dl { display:grid; grid-template-columns:110px 1fr; gap:4px 10px; margin:10px 0; font-size:0.92rem; }
  dt { color:var(--muted); } dd { margin:0; word-break:break-word; }
  input[type=url] { width:100%; padding:8px 10px; border:1px solid var(--line); border-radius:8px; font:inherit; }
  .actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
  button { font:inherit; border:0; border-radius:8px; padding:8px 14px; cursor:pointer; }
  .accept { background:#dcfce7; color:var(--ok); } .skip { background:#f5f5f4; color:var(--skip); }
  .done { opacity:0.55; }
  footer { max-width:920px; margin:20px auto 40px; padding:0 24px; }
  #download { background:#1c1917; color:#fff; }
</style>
</head>
<body>
<header>
  <h1>Pass 8 · Landing hosts → LinkedIn</h1>
  <p class="sub">Accept proposed /in URLs (or paste an alternate). Export JSON for enrich.</p>
</header>
<div id="stats"></div>
<div id="list"></div>
<footer>
  <button type="button" id="download">Download pass8_submissions.json</button>
</footer>
<script>
const items = ${itemsJson};
const state = new Map();
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));}
function normalizeLi(raw){
  const s=(raw||'').trim(); if(!s) return '';
  try{
    const u=new URL(/^https?:\\/\\//i.test(s)?s:'https://'+s);
    if(!/linkedin\\.com/i.test(u.hostname)) return '';
    const m=u.pathname.match(/\\/in\\/([^/?#]+)/i); if(!m) return '';
    return 'https://www.linkedin.com/in/'+decodeURIComponent(m[1]).replace(/\\/$/,'');
  }catch{return '';}
}
function render(){
  const accepted=[...state.values()].filter(x=>x.status==='saved').length;
  const skipped=[...state.values()].filter(x=>x.status==='skipped').length;
  document.getElementById('stats').textContent = items.length+' proposals · '+accepted+' accepted · '+skipped+' skipped';
  document.getElementById('list').innerHTML = items.map((item,idx)=>{
    const st=state.get(item.ad_id);
    const done=st?' done':'';
    const val=st?.linkedin_url || item.linkedin_url || '';
    return '<article class="card'+done+'" data-idx="'+idx+'">'+
      '<h2>'+escapeHtml(item.company_name)+'</h2>'+
      '<div class="meta">'+escapeHtml(item.platform)+
        (item.landing_url?' · <a href="'+escapeHtml(item.landing_url)+'" target="_blank" rel="noopener">Landing</a>':'')+
        (item.ad_library_url?' · <a href="'+escapeHtml(item.ad_library_url)+'" target="_blank" rel="noopener">Ad</a>':'')+
      '</div>'+
      '<dl>'+
        '<dt>Landing people</dt><dd>'+escapeHtml(item.landing_people||'—')+'</dd>'+
        '<dt>Evidence</dt><dd>'+escapeHtml(item.evidence||'—')+'</dd>'+
        '<dt>Proposed person</dt><dd>'+escapeHtml(item.person_name||'—')+'</dd>'+
        '<dt>Headline</dt><dd>'+escapeHtml(item.headline||'—')+'</dd>'+
        '<dt>Company</dt><dd>'+escapeHtml(item.company||'—')+'</dd>'+
        '<dt>Source</dt><dd>'+escapeHtml(item.profile_source||item.status||'—')+'</dd>'+
      '</dl>'+
      '<label>LinkedIn /in URL<br/><input type="url" data-ad="'+escapeHtml(item.ad_id)+'" value="'+escapeHtml(val)+'" placeholder="https://www.linkedin.com/in/…" /></label>'+
      '<div class="actions">'+
        '<button type="button" class="accept" data-act="accept" data-ad="'+escapeHtml(item.ad_id)+'">Accept</button>'+
        '<button type="button" class="skip" data-act="skip" data-ad="'+escapeHtml(item.ad_id)+'">Skip</button>'+
      '</div></article>';
  }).join('');
}
document.getElementById('list').addEventListener('click',(e)=>{
  const btn=e.target.closest('button[data-act]'); if(!btn) return;
  const ad=btn.getAttribute('data-ad');
  const item=items.find(x=>x.ad_id===ad); if(!item) return;
  if(btn.getAttribute('data-act')==='skip'){
    state.set(ad,{ad_id:ad,status:'skipped',linkedin_url:'',company_name:item.company_name,company_domain:item.company_domain,person_name_hint:item.person_name,ad_library_url:item.ad_library_url,platform:item.platform,note:'pass8_skip'});
    render(); return;
  }
  const input=document.querySelector('input[data-ad="'+CSS.escape(ad)+'"]');
  const url=normalizeLi(input?.value||'');
  if(!url){ alert('Need a valid linkedin.com/in/... URL'); return; }
  state.set(ad,{ad_id:ad,status:'saved',linkedin_url:url,company_name:item.company_name,company_domain:item.company_domain,person_name_hint:item.person_name,ad_library_url:item.ad_library_url,platform:item.platform,note:'pass8_landing_host',headline:item.headline,profile_company:item.company});
  render();
});
document.getElementById('download').onclick=()=>{
  const submissions=[...state.values()].filter(x=>x.status==='saved');
  const blob=new Blob([JSON.stringify({version:1,submissions},null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='pass8_submissions.json'; a.click(); URL.revokeObjectURL(a.href);
};
render();
</script>
</body>
</html>`;
}

export function seedPersonHints(pass8Dir: string): number {
  const eligiblePath = join(pass8Dir, 'eligible.csv');
  const peoplePath = join(pass8Dir, 'landing_people.csv');
  if (!existsSync(eligiblePath)) return 0;
  const eligible = readCsv(eligiblePath);
  const people = existsSync(peoplePath) ? readCsv(peoplePath) : [];
  const seen = new Set(
    people
      .filter((r) => r.status === 'found' && r.person_name)
      .map((r) => `${r.ad_id}|${r.person_name.toLowerCase()}`),
  );
  let added = 0;
  for (const row of eligible) {
    const hint = (row.person_name_hint || '').trim();
    if (!looksLikePersonName(hint)) continue;
    // Extra junk often present in ad-extracted "person" fields
    if (
      /obedience|peak rock|west china|outdoor industry|confidence seating/i.test(hint)
    ) {
      continue;
    }
    const key = `${row.ad_id}|${hint.toLowerCase()}`;
    if (seen.has(key)) continue;
    people.push({
      ad_id: row.ad_id || '',
      company_name: row.company_name || '',
      company_domain: row.company_domain || '',
      platform: row.platform || '',
      landing_url: row.scrape_url || row.landing_url || '',
      person_name: hint,
      evidence: 'person_name_hint',
      source: 'ad_person_hint',
      status: 'found',
      error: '',
      ad_library_url: row.ad_library_url || '',
    });
    seen.add(key);
    added += 1;
  }
  writeCsv(peoplePath, people, [
    'ad_id',
    'company_name',
    'company_domain',
    'platform',
    'landing_url',
    'person_name',
    'evidence',
    'source',
    'status',
    'error',
    'ad_library_url',
  ]);
  return added;
}

export function writePass8Review(pass8Dir: string): string {
  const html = buildPass8ReviewHtml(pass8Dir);
  const path = join(pass8Dir, 'pass8_review.html');
  writeText(path, html);
  return path;
}
