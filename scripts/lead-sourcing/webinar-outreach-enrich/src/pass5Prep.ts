import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, readCsv, writeCsv, writeJson, writeText } from './io.js';
import { GENERIC_DOMAINS, normalizeDomain } from './types.js';
import { classifyConsumerTargeted } from './consumerFilter.js';
import { extractAdCopySignals } from './adCopySignals.js';

export const PASS5_DARK_COLUMNS = [
  'priority',
  'priority_bucket',
  'platform',
  'company_name',
  'company_domain',
  'person_name',
  'ad_id',
  'ad_library_url',
  'ad_headline',
  'ad_copy',
  'ad_active_from',
  'phrases_found',
  'landing_url',
  'landing_domain',
  'google_company_url',
  'google_webinar_url',
  'linkedin_search_url',
] as const;

function host(raw: string): string {
  return normalizeDomain(raw) || '';
}

function usableDomain(raw: string): string {
  const d = host(raw);
  if (!d) return '';
  if (GENERIC_DOMAINS.has(d)) return '';
  if ([...GENERIC_DOMAINS].some((g) => d === g || d.endsWith(`.${g}`))) return '';
  return d;
}

function looksLikeRealPersonName(name: string): boolean {
  const p = name.trim();
  if (!p) return false;
  const parts = p.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  const junk =
    /^(our webinar|market research|outdoor industry|expensive obedience|confidence seating|safeguard estate|smarter planning|angels foster|california correctional|psychiatry update|psychic medium|west china|medicare get|michigan education|our free|their reactive|new york|peak rock)$/i;
  return !junk.test(p);
}

function loadSourceAds(packageRoot: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  const paths = [
    join(packageRoot, '../meta-webinar-ads/output/exports/webinar-outreach.csv'),
    join(packageRoot, '../linkedin-webinar-ads/output/exports/linkedin-webinar-outreach.csv'),
  ];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    for (const row of readCsv(path)) {
      const id = (row.ad_id || '').trim();
      if (id) out.set(id, row);
    }
  }
  return out;
}

function loadRehydratedDomains(pass1Dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const path = join(pass1Dir, 'pass7', 'rehydrated_landings.csv');
  if (!existsSync(path)) return out;
  for (const row of readCsv(path)) {
    if (row.status === 'recovered' && row.ad_id && row.normalized_domain) {
      const d = usableDomain(row.normalized_domain);
      if (d) out.set(row.ad_id, d);
    }
  }
  return out;
}

function loadHaveEmail(pass1Dir: string): {
  byAdId: Set<string>;
  byCompanyName: Set<string>;
} {
  const byAdId = new Set<string>();
  const byCompanyName = new Set<string>();
  const candidates = [
    join(pass1Dir, 'pass7', 'enriched_leads.csv'),
    join(pass1Dir, 'pass5', 'enriched_leads.csv'),
    join(pass1Dir, 'pass6', 'enriched_leads.csv'),
    join(pass1Dir, 'pass4', 'enriched_leads.csv'),
    join(pass1Dir, 'pass3', 'enriched_leads.csv'),
    join(pass1Dir, 'enriched_leads_pass7.csv'),
    join(pass1Dir, 'enriched_leads_pass6.csv'),
    join(pass1Dir, 'enriched_leads_pass5.csv'),
    join(pass1Dir, 'enriched_leads_pass4.csv'),
    join(pass1Dir, 'enriched_leads.csv'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    for (const row of readCsv(path)) {
      if (!(row.contact_email || '').trim()) continue;
      const ad = (row.ad_id || '').trim();
      if (ad) byAdId.add(ad);
      const name = (row.company_name || '').trim().toLowerCase();
      if (name) byCompanyName.add(name);
    }
    break; // prefer newest single file
  }
  return { byAdId, byCompanyName };
}

function buildWorklistHtml(items: Record<string, string>[]): string {
  const itemsJson = JSON.stringify(items);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Pass 5 · Manual LinkedIn</title>
<style>
  :root {
    --bg:#f3efe6; --ink:#1c1917; --muted:#6b645b; --card:#fffdf8; --line:#e4dccf;
    --p1:#1d4ed8; --p1bg:#eff6ff; --p2:#047857; --p2bg:#ecfdf5; --p3:#78716c; --p3bg:#f5f5f4;
    --save:#166534; --skip:#57534e; --none:#9f1239;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; color:var(--ink);
    font-family:"IBM Plex Sans","Segoe UI",ui-sans-serif,system-ui,sans-serif;
    background:
      radial-gradient(900px 500px at 0% 0%, #e7dfd0, transparent 60%),
      radial-gradient(800px 400px at 100% 0%, #dde8df, transparent 55%),
      var(--bg);
  }
  header {
    position:sticky; top:0; z-index:10;
    background:rgba(243,239,230,.92); backdrop-filter:blur(12px);
    border-bottom:1px solid var(--line); padding:12px 0;
  }
  .wrap { max-width:1100px; margin:0 auto; padding:0 16px 56px; }
  h1 { margin:0; font-size:1.25rem; letter-spacing:-.02em; }
  .sub { color:var(--muted); font-size:.9rem; margin-top:2px; }
  .stats,.toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:10px; }
  .pill { border:1px solid var(--line); border-radius:999px; padding:4px 10px; font-size:.78rem; background:#fff; }
  .pill.p1 { background:var(--p1bg); color:var(--p1); border-color:#bfdbfe; }
  .pill.p2 { background:var(--p2bg); color:var(--p2); border-color:#a7f3d0; }
  .pill.p3 { background:var(--p3bg); color:var(--p3); }
  button, .btn {
    appearance:none; border:1px solid var(--line); background:#fff; border-radius:10px;
    padding:8px 12px; font:inherit; cursor:pointer;
  }
  button.primary { background:var(--ink); color:#fff; border-color:var(--ink); }
  button.save { background:var(--save); color:#fff; border-color:var(--save); }
  button.none { background:var(--none); color:#fff; border-color:var(--none); }
  .progress { height:6px; background:#e4dccf; border-radius:999px; overflow:hidden; margin:14px 0; }
  .progress>span { display:block; height:100%; width:0; background:#292524; transition:width .2s; }
  .card {
    background:var(--card); border:1px solid var(--line); border-radius:18px; padding:18px;
    box-shadow:0 12px 36px rgba(28,25,23,.05);
  }
  .hidden { display:none !important; }
  .badge { display:inline-block; font-size:.72rem; font-weight:700; padding:3px 8px; border-radius:999px; margin-bottom:8px; }
  .badge.p1 { background:var(--p1bg); color:var(--p1); }
  .badge.p2 { background:var(--p2bg); color:var(--p2); }
  .badge.p3 { background:var(--p3bg); color:var(--p3); }
  .company { margin:0 0 4px; font-size:1.5rem; letter-spacing:-.03em; }
  .meta { color:var(--muted); font-size:.88rem; margin-bottom:12px; }
  .cols { display:grid; grid-template-columns:1.15fr 1fr; gap:14px; }
  @media (max-width:900px) { .cols { grid-template-columns:1fr; } }
  .panel { border:1px solid var(--line); border-radius:14px; background:#faf7f1; overflow:hidden; }
  .panel h3 {
    margin:0; padding:10px 12px; font-size:.78rem; text-transform:uppercase;
    letter-spacing:.07em; color:var(--muted); border-bottom:1px solid var(--line); background:#f3eee4;
  }
  .panel .body { padding:12px; }
  .adcopy {
    white-space:pre-wrap; font-size:.95rem; line-height:1.45; max-height:220px; overflow:auto;
    background:#fff; border:1px solid var(--line); border-radius:10px; padding:10px 12px;
  }
  .headline { font-weight:700; font-size:1.05rem; margin:0 0 8px; }
  .kv { display:grid; grid-template-columns:110px 1fr; gap:6px 10px; font-size:.92rem; margin:0; }
  .kv dt { color:var(--muted); }
  .kv dd { margin:0; word-break:break-word; }
  .links { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
  .links a {
    display:inline-block; padding:7px 10px; border-radius:9px; border:1px solid var(--line);
    background:#fff; color:#1d4ed8; text-decoration:none; font-size:.85rem;
  }
  label.field { display:block; margin-top:10px; font-size:.8rem; color:var(--muted); }
  input[type=url], input[type=text], textarea {
    width:100%; margin-top:4px; padding:10px 12px; border-radius:10px; border:1px solid var(--line);
    font:inherit; background:#fff;
  }
  textarea { min-height:64px; resize:vertical; }
  .actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:14px; }
  .hint { margin-left:auto; color:var(--muted); font-size:.8rem; }
  .done { text-align:center; padding:40px 16px; border:1px dashed var(--line); border-radius:16px; background:#fff; }
  .export { margin-top:16px; background:#fff; border:1px solid var(--line); border-radius:12px; padding:12px; }
  #exportBox { width:100%; min-height:120px; font-family:ui-monospace,Menlo,monospace; font-size:.78rem; }
  .list { margin-top:16px; }
  .row {
    display:grid; grid-template-columns:100px 1fr auto; gap:10px; align-items:center;
    padding:8px 10px; border-bottom:1px solid var(--line); font-size:.86rem;
  }
  .row .status.saved { color:var(--save); font-weight:700; }
  .row .status.skipped { color:var(--skip); font-weight:700; }
  .row .status.no_person { color:var(--none); font-weight:700; }
  .row .status.pending { color:var(--muted); }
  .err { color:var(--none); font-size:.85rem; margin-top:6px; }
</style>
</head>
<body>
<header>
  <div class="wrap">
    <h1>Pass 5 · Manual LinkedIn</h1>
    <div class="sub">Find a person on LinkedIn for each advertiser, paste their <strong>profile URL</strong> (<code>/in/...</code>), then export. Enrich runs separately with spend OK.</div>
    <div class="stats">
      <span class="pill p1" id="p1Pill">P1 domain</span>
      <span class="pill p2" id="p2Pill">P2 named</span>
      <span class="pill p3" id="p3Pill">P3 other</span>
      <span class="pill" id="decidedPill">0 decided</span>
    </div>
    <div class="toolbar">
      <label><input type="radio" name="filter" value="todo" checked> To-do</label>
      <label><input type="radio" name="filter" value="p1"> P1 only</label>
      <label><input type="radio" name="filter" value="saved"> Saved URLs</label>
      <label><input type="radio" name="filter" value="all"> All</label>
      <button type="button" id="prevBtn">← Prev</button>
      <button type="button" id="nextBtn">Next →</button>
      <button type="button" class="primary" id="exportBtn">Export submissions</button>
      <button type="button" id="clearBtn">Clear local</button>
    </div>
  </div>
</header>
<main class="wrap">
  <div class="progress"><span id="bar"></span></div>
  <div id="card" class="card"></div>
  <div id="empty" class="done hidden"><h2>Queue clear</h2><p class="sub">Switch filter or export below.</p></div>
  <div class="export">
    <div class="sub" style="margin-bottom:6px">Export JSON → save as <code>manual_linkedin_submissions.json</code> in the pass5 folder (or paste path when enriching).</div>
    <textarea id="exportBox" readonly></textarea>
    <div class="toolbar" style="margin-top:8px">
      <button type="button" id="copyBtn">Copy JSON</button>
      <button type="button" id="downloadBtn">Download JSON</button>
    </div>
  </div>
  <div class="list" id="list"></div>
</main>
<script>
const ITEMS = ${itemsJson};
const STORAGE_KEY = 'furnace.pass5.manual_linkedin.v1';
const bucketLabel = {1:'P1 · has domain',2:'P2 · named person',3:'P3 · other'};

function loadDecisions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function saveDecisions(d) { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }
let decisions = loadDecisions();
let filter = 'todo';
let index = 0;

function escapeHtml(s) {
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

function normalizeLinkedInUrl(raw) {
  const s = String(raw||'').trim();
  if (!s) return '';
  try {
    const u = new URL(s.startsWith('http') ? s : 'https://' + s);
    if (!u.hostname.toLowerCase().includes('linkedin.com')) return '';
    const m = u.pathname.match(/\\/in\\/([^\\/?#]+)/i);
    if (!m) return '';
    return 'https://www.linkedin.com/in/' + decodeURIComponent(m[1]).replace(/\\/$/, '');
  } catch { return ''; }
}

function visibleItems() {
  return ITEMS.filter(item => {
    const d = decisions[item.ad_id];
    if (filter === 'todo') return !d;
    if (filter === 'p1') return String(item.priority) === '1' && !d;
    if (filter === 'saved') return d && d.status === 'saved';
    return true;
  });
}

function exportPayload() {
  const saved = [];
  const skipped = [];
  const no_person = [];
  for (const item of ITEMS) {
    const d = decisions[item.ad_id];
    if (!d) continue;
    const row = {
      ad_id: item.ad_id,
      platform: item.platform,
      company_name: item.company_name,
      company_domain: item.company_domain,
      person_name_hint: item.person_name || '',
      ad_library_url: item.ad_library_url,
      linkedin_url: d.linkedin_url || '',
      note: d.note || '',
      status: d.status,
      decided_at: d.at,
    };
    if (d.status === 'saved') saved.push(row);
    else if (d.status === 'no_person') no_person.push(row);
    else skipped.push(row);
  }
  return {
    generated_at: new Date().toISOString(),
    total: ITEMS.length,
    saved_count: saved.length,
    skipped_count: skipped.length,
    no_person_count: no_person.length,
    pending_count: ITEMS.length - saved.length - skipped.length - no_person.length,
    submissions: saved,
    skipped,
    no_person,
  };
}

function updateExport() {
  const payload = exportPayload();
  document.getElementById('exportBox').value = JSON.stringify(payload, null, 2);
  const decided = payload.saved_count + payload.skipped_count + payload.no_person_count;
  document.getElementById('decidedPill').textContent = decided + ' decided / ' + ITEMS.length;
  document.getElementById('bar').style.width = (ITEMS.length ? Math.round(100 * decided / ITEMS.length) : 0) + '%';
  const c1 = ITEMS.filter(i => String(i.priority)==='1').length;
  const c2 = ITEMS.filter(i => String(i.priority)==='2').length;
  const c3 = ITEMS.filter(i => String(i.priority)==='3').length;
  document.getElementById('p1Pill').textContent = c1 + ' P1 domain';
  document.getElementById('p2Pill').textContent = c2 + ' P2 named';
  document.getElementById('p3Pill').textContent = c3 + ' P3 other';
  renderList();
}

function renderList() {
  const el = document.getElementById('list');
  el.innerHTML = ITEMS.map(item => {
    const d = decisions[item.ad_id];
    const st = d ? d.status : 'pending';
    return \`<div class="row">
      <span class="status \${st}">\${st}</span>
      <span><strong>\${escapeHtml(item.company_name)}</strong><br><span style="color:#6b645b">\${escapeHtml(d?.linkedin_url || item.company_domain || 'no domain')} · P\${escapeHtml(item.priority)}</span></span>
      <button type="button" data-jump="\${escapeHtml(item.ad_id)}">Open</button>
    </div>\`;
  }).join('');
  el.querySelectorAll('[data-jump]').forEach(btn => {
    btn.addEventListener('click', () => {
      filter = 'all';
      document.querySelector('input[name=filter][value=all]').checked = true;
      const items = visibleItems();
      index = Math.max(0, items.findIndex(i => i.ad_id === btn.getAttribute('data-jump')));
      render();
    });
  });
}

function decide(status, extra = {}) {
  const items = visibleItems();
  const item = items[index];
  if (!item) return;
  if (status === 'saved') {
    const url = normalizeLinkedInUrl(extra.linkedin_url || '');
    if (!url) {
      const err = document.getElementById('urlErr');
      if (err) err.textContent = 'Need a valid linkedin.com/in/... profile URL';
      return;
    }
    decisions[item.ad_id] = {
      status: 'saved',
      linkedin_url: url,
      note: (extra.note || '').trim(),
      at: new Date().toISOString(),
    };
  } else {
    decisions[item.ad_id] = { status, linkedin_url: '', note: (extra.note || '').trim(), at: new Date().toISOString() };
  }
  saveDecisions(decisions);
  const next = visibleItems();
  if (index >= next.length) index = Math.max(0, next.length - 1);
  render();
}

function render() {
  const items = visibleItems();
  const card = document.getElementById('card');
  const empty = document.getElementById('empty');
  updateExport();
  if (!items.length) { card.classList.add('hidden'); empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden'); card.classList.remove('hidden');
  if (index >= items.length) index = items.length - 1;
  if (index < 0) index = 0;
  const item = items[index];
  const existing = decisions[item.ad_id] || {};
  const adcopy = item.ad_copy
    ? \`<div class="headline">\${escapeHtml(item.ad_headline || '(no headline)')}</div><div class="adcopy">\${escapeHtml(item.ad_copy)}</div>\`
    : \`<div class="adcopy" style="color:#6b645b">No ad copy — open ad library.</div>\`;

  card.innerHTML = \`
    <div class="badge p\${escapeHtml(item.priority)}">\${bucketLabel[item.priority] || item.priority} · \${index+1} / \${items.length}</div>
    <h2 class="company">\${escapeHtml(item.company_name)}</h2>
    <div class="meta">\${escapeHtml(item.platform)} · \${escapeHtml(item.company_domain || 'no domain')} · ad \${escapeHtml(item.ad_id)}</div>
    <div class="cols">
      <div class="panel">
        <h3>Ad creative</h3>
        <div class="body">
          \${adcopy}
          <dl class="kv" style="margin-top:12px">
            <dt>Named in ad</dt><dd>\${escapeHtml(item.person_name || '—')}</dd>
            <dt>Landing</dt><dd>\${item.landing_url ? \`<a href="\${escapeHtml(item.landing_url)}" target="_blank" rel="noopener">\${escapeHtml(item.landing_url)}</a>\` : '—'}</dd>
            <dt>Ad library</dt><dd>\${item.ad_library_url ? \`<a href="\${escapeHtml(item.ad_library_url)}" target="_blank" rel="noopener">Open ad ↗</a>\` : '—'}</dd>
          </dl>
        </div>
      </div>
      <div class="panel">
        <h3>Find on LinkedIn</h3>
        <div class="body">
          <div class="links">
            <a href="\${escapeHtml(item.linkedin_search_url)}" target="_blank" rel="noopener">LinkedIn search</a>
            <a href="\${escapeHtml(item.google_company_url)}" target="_blank" rel="noopener">Google company</a>
            <a href="\${escapeHtml(item.google_webinar_url)}" target="_blank" rel="noopener">Google webinar</a>
            \${item.company_domain ? \`<a href="https://\${escapeHtml(item.company_domain)}" target="_blank" rel="noopener">Company site</a>\` : ''}
          </div>
          <label class="field">Person LinkedIn URL (/in/...)
            <input type="url" id="liUrl" placeholder="https://www.linkedin.com/in/..." value="\${escapeHtml(existing.linkedin_url || '')}" />
          </label>
          <div class="err" id="urlErr"></div>
          <label class="field">Optional note (name / title)
            <input type="text" id="liNote" placeholder="Jane Doe, VP Marketing" value="\${escapeHtml(existing.note || '')}" />
          </label>
        </div>
      </div>
    </div>
    <div class="actions">
      <button type="button" class="save" id="saveBtn">Save URL (Enter)</button>
      <button type="button" id="skipBtn">Skip (S)</button>
      <button type="button" class="none" id="noneBtn">No person (N)</button>
      <span class="hint">Enter save · S skip · N no person · ← →</span>
    </div>
  \`;
  document.getElementById('saveBtn').onclick = () => decide('saved', {
    linkedin_url: document.getElementById('liUrl').value,
    note: document.getElementById('liNote').value,
  });
  document.getElementById('skipBtn').onclick = () => decide('skipped', { note: document.getElementById('liNote').value });
  document.getElementById('noneBtn').onclick = () => decide('no_person', { note: document.getElementById('liNote').value });
  const urlInput = document.getElementById('liUrl');
  urlInput.focus();
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      decide('saved', { linkedin_url: urlInput.value, note: document.getElementById('liNote').value });
    }
  });
}

document.querySelectorAll('input[name=filter]').forEach(r => r.addEventListener('change', e => {
  filter = e.target.value; index = 0; render();
}));
document.getElementById('prevBtn').onclick = () => { index = Math.max(0, index - 1); render(); };
document.getElementById('nextBtn').onclick = () => {
  const items = visibleItems();
  index = Math.min(items.length - 1, index + 1);
  render();
};
document.getElementById('exportBtn').onclick = () => {
  updateExport();
  document.getElementById('exportBox').scrollIntoView({ behavior: 'smooth' });
};
document.getElementById('copyBtn').onclick = async () => {
  updateExport();
  await navigator.clipboard.writeText(document.getElementById('exportBox').value);
  document.getElementById('copyBtn').textContent = 'Copied';
  setTimeout(() => document.getElementById('copyBtn').textContent = 'Copy JSON', 1200);
};
document.getElementById('downloadBtn').onclick = () => {
  updateExport();
  const blob = new Blob([document.getElementById('exportBox').value], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'manual_linkedin_submissions.json';
  a.click();
};
document.getElementById('clearBtn').onclick = () => {
  if (!confirm('Clear all local decisions?')) return;
  decisions = {};
  saveDecisions(decisions);
  index = 0;
  render();
};
window.addEventListener('keydown', (e) => {
  if (e.target.matches('textarea,input')) {
    if (e.key === 'Enter' && e.target.id === 'liUrl') return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  }
  const k = e.key.toLowerCase();
  if (k === 's' && !e.target.matches('input,textarea')) {
    decide('skipped');
  } else if (k === 'n' && !e.target.matches('input,textarea')) {
    decide('no_person');
  } else if (e.key === 'ArrowLeft') {
    index = Math.max(0, index - 1); render();
  } else if (e.key === 'ArrowRight') {
    const items = visibleItems();
    index = Math.min(items.length - 1, index + 1); render();
  }
});
render();
</script>
</body>
</html>`;
}

export function prepPass5(options: {
  pass1Dir: string;
  pass5Dir: string;
  packageRoot: string;
}): {
  dark: number;
  p1: number;
  p2: number;
  p3: number;
  dropped_consumer: number;
  htmlPath: string;
  csvPath: string;
} {
  const pass5Dir = ensureDir(options.pass5Dir);
  const { byAdId, byCompanyName } = loadHaveEmail(options.pass1Dir);
  const source = loadSourceAds(options.packageRoot);
  const rehydrated = loadRehydratedDomains(options.pass1Dir);

  const liPath = join(options.pass1Dir, 'linkedin_cohort.csv');
  const metaPath = join(options.pass1Dir, 'meta_cohort.csv');
  const cohort: Record<string, string>[] = [];
  if (existsSync(liPath)) cohort.push(...readCsv(liPath));
  if (existsSync(metaPath)) cohort.push(...readCsv(metaPath));

  const seenCompany = new Set<string>();
  const dark: Record<string, string>[] = [];
  const droppedConsumer: Record<string, string>[] = [];

  for (const row of cohort) {
    const adId = (row.ad_id || '').trim();
    if (!adId) continue;
    if (byAdId.has(adId)) continue;
    const companyName = (row.company_name || '').trim();
    const companyKeyName = companyName.toLowerCase();
    if (companyKeyName && byCompanyName.has(companyKeyName)) continue;
    if (companyKeyName && seenCompany.has(companyKeyName)) continue;
    if (companyKeyName) seenCompany.add(companyKeyName);

    const src = source.get(adId) || {};
    const ad_copy = src.ad_copy || row.ad_copy || '';
    const ad_headline = src.ad_headline || row.ad_headline || '';
    const consumer = classifyConsumerTargeted({
      company_name: companyName,
      ad_copy,
      ad_headline,
    });
    if (consumer.is_consumer) {
      droppedConsumer.push({
        ad_id: adId,
        platform: row.platform || src.platform || '',
        company_name: companyName,
        ad_library_url: row.ad_library_url || src.ad_library_url || '',
        drop_reasons: consumer.reasons.join('|'),
        ad_headline,
        ad_copy: ad_copy.slice(0, 500),
      });
      continue;
    }

    const signals = extractAdCopySignals({
      company_name: companyName,
      ad_copy,
      ad_headline,
    });
    const domain =
      usableDomain(row.company_domain || '') ||
      usableDomain(row.landing_domain || '') ||
      usableDomain(src.landing_domain || '') ||
      usableDomain(src.landing_url || '') ||
      usableDomain(row.landing_url || '') ||
      rehydrated.get(adId) ||
      signals.domains[0] ||
      usableDomain(src.company_url || '');
    const person = (row.person_name || src.person_name || '').trim();
    const hasPerson = looksLikeRealPersonName(person);

    let priority = 3;
    let bucket = 'other';
    if (domain) {
      priority = 1;
      bucket = 'has_domain';
    } else if (hasPerson) {
      priority = 2;
      bucket = 'named_person';
    }

    const qCompany = encodeURIComponent(`${companyName} official website`);
    const qWebinar = encodeURIComponent(`"${companyName}" webinar`);
    const qLi = encodeURIComponent(
      hasPerson ? `${person} ${companyName}` : `${companyName}`,
    );

    const landingUrl = row.landing_url || src.landing_url || '';
    dark.push({
      priority: String(priority),
      priority_bucket: bucket,
      platform: row.platform || src.platform || '',
      company_name: companyName,
      company_domain: domain,
      person_name: person,
      ad_id: adId,
      ad_library_url: row.ad_library_url || src.ad_library_url || '',
      ad_headline,
      ad_copy,
      ad_active_from: src.ad_active_from || '',
      phrases_found: src.phrases_found || '',
      landing_url: landingUrl,
      landing_domain:
        usableDomain(row.landing_domain || src.landing_domain || '') ||
        usableDomain(landingUrl) ||
        '',
      google_company_url: `https://www.google.com/search?q=${qCompany}`,
      google_webinar_url: `https://www.google.com/search?q=${qWebinar}`,
      linkedin_search_url: `https://www.linkedin.com/search/results/people/?keywords=${qLi}`,
    });
  }

  dark.sort((a, b) => {
    const pa = Number(a.priority) - Number(b.priority);
    if (pa !== 0) return pa;
    return (a.company_name || '').localeCompare(b.company_name || '');
  });

  const csvPath = join(pass5Dir, 'dark_advertisers.csv');
  writeCsv(csvPath, dark, [...PASS5_DARK_COLUMNS]);
  writeCsv(
    join(pass5Dir, 'dropped_consumer.csv'),
    droppedConsumer,
    [
      'ad_id',
      'platform',
      'company_name',
      'ad_library_url',
      'drop_reasons',
      'ad_headline',
      'ad_copy',
    ],
  );

  const htmlPath = join(pass5Dir, 'manual_linkedin_worklist.html');
  writeText(htmlPath, buildWorklistHtml(dark));

  const p1 = dark.filter((r) => r.priority === '1').length;
  const p2 = dark.filter((r) => r.priority === '2').length;
  const p3 = dark.filter((r) => r.priority === '3').length;

  writeJson(join(pass5Dir, 'prep_tally.json'), {
    dark_unique_advertisers: dark.length,
    p1_has_domain: p1,
    p2_named_person: p2,
    p3_other: p3,
    dropped_consumer: droppedConsumer.length,
    have_email_ads: byAdId.size,
    have_email_company_names: byCompanyName.size,
  });

  return {
    dark: dark.length,
    p1,
    p2,
    p3,
    dropped_consumer: droppedConsumer.length,
    htmlPath,
    csvPath,
  };
}

/** Normalize a pasted LinkedIn person URL to https://www.linkedin.com/in/{slug} */
export function normalizeLinkedInProfileUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  try {
    const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    const u = new URL(withProto);
    if (!u.hostname.toLowerCase().includes('linkedin.com')) return '';
    const m = u.pathname.match(/\/in\/([^/?#]+)/i);
    if (!m?.[1]) return '';
    const slug = decodeURIComponent(m[1]).replace(/\/$/, '');
    if (!slug) return '';
    return `https://www.linkedin.com/in/${slug}`;
  } catch {
    return '';
  }
}
