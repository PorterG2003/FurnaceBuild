import type { Stage3Row } from '../lib/types.js';

export function dedupeEntities(rows: Stage3Row[]): Stage3Row[] {
  const byKey = new Map<string, Stage3Row>();
  for (const row of rows) {
    const key = row.apollo_org_id || row.company_domain || row.company_name.toLowerCase();
    if (!key) {
      byKey.set(`${row.sample_post_url}-${byKey.size}`, row);
      continue;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    existing.post_count = String(Number(existing.post_count || 0) + Number(row.post_count || 0));
    if (!existing.registration_urls && row.registration_urls) existing.registration_urls = row.registration_urls;
    if (!existing.webinar_topic && row.webinar_topic) existing.webinar_topic = row.webinar_topic;
  }
  return [...byKey.values()];
}
