import { join, resolve } from 'node:path';
import { parseCliArgs } from './lib/cli.js';
import { writeCsv, rowToRecord } from './lib/csv.js';
import { packageRoot } from './lib/env.js';
import { writeJson } from './lib/io.js';
import { sleep, withRetry } from './lib/retry.js';

const DIRECTORY_URL = 'https://www.boe.rale.k12.wv.us/staff/?page_no=';
const API_URL =
  'https://thrillshare-cmsv2.services.thrillshare.com/api/v2/s/163549/directories';

type DirectoryPerson = {
  full_name?: string | null;
  title?: string | null;
  department?: string | null;
  email?: string | null;
};

type DirectoryResponse = {
  directories?: DirectoryPerson[];
  meta?: { links?: { next?: string | null } };
};

export async function collectRaleighEmails(runDir: string): Promise<{
  pages: number;
  emails: number;
}> {
  const emails = new Map<string, { person: DirectoryPerson; pageNo: number }>();
  let pages = 0;

  for (let pageNo = 1; pageNo <= 100; pageNo += 1) {
    const response = await withRetry(
      async () => {
        const result = await fetch(`${API_URL}?page_no=${pageNo}`);
        if (!result.ok) throw new Error(`Raleigh directory HTTP ${result.status}`);
        return (await result.json()) as DirectoryResponse;
      },
      { maxAttempts: 3, baseDelayMs: 750 },
    );
    pages += 1;
    for (const person of response.directories ?? []) {
      const email = person.email?.trim().toLowerCase() ?? '';
      if (!email.endsWith('@k12.wv.us') && !email.endsWith('@raleighcountyschools.org')) continue;
      emails.set(email, { person, pageNo });
    }
    if (!response.meta?.links?.next) break;
    await sleep(100);
  }
  emails.set('webmaster@raleighcountyschools.org', {
    person: { full_name: 'Raleigh County Schools Webmaster', title: 'General contact' },
    pageNo: 1,
  });

  const rows = [...emails.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([email, hit]) =>
      rowToRecord({
        email,
        type: 'email',
        organization: 'Raleigh County Schools',
        staff_name: hit.person.full_name ?? '',
        title: hit.person.title ?? '',
        department: hit.person.department ?? '',
        evidence_url: `${DIRECTORY_URL}${hit.pageNo}`,
      }),
    );
  writeCsv(join(runDir, 'raleigh_staff_emails.csv'), rows, [
    'email',
    'type',
    'organization',
    'staff_name',
    'title',
    'department',
    'evidence_url',
  ]);
  const summary = {
    directory_pages_fetched: pages,
    published_staff_emails: rows.length,
    statewide_domain_not_blocked: 'k12.wv.us',
  };
  writeJson(join(runDir, 'raleigh_staff_emails_summary.json'), summary);
  console.log(JSON.stringify(summary, null, 2));
  return { pages, emails: rows.length };
}

async function main(): Promise<void> {
  const cli = parseCliArgs();
  const runDir = resolve(cli.runDir ?? join(packageRoot, 'output/runs/full-1'));
  await collectRaleighEmails(runDir);
}

if (process.argv[1]?.includes('collectRaleighEmails.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
