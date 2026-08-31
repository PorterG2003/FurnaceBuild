/**
 * Post-run fold: drop junk hosts, promote official district sites that had
 * no published emails (Cloudflare), and apply known mail-domain corrections.
 *
 * Usage: npx tsx src/fold.ts --run-dir output/runs/full-1
 */
import { join, resolve } from 'node:path';
import { parseCliArgs } from './lib/cli.js';
import { readCsv, writeCsv, rowToRecord } from './lib/csv.js';
import { writeJson } from './lib/io.js';
import { packageRoot } from './lib/env.js';

const JUNK = new Set([
  'azed.gov',
  'ballotpedia.org',
  'cityofirvine.org',
  'dlcga.com',
  'isbe.net',
  'neric.org',
  'osbe.idaho.gov',
  'northridge.k12.oh.us',
  'ph.ucla.edu',
  'newyorkschools.us',
  'ed.gov',
  'elementaryschools.org',
  'bellflower.ca.gov',
  'ed.sc.gov',
  'nashville.gov',
  'backgroundchecks.org',
  'temeculaca.gov',
  'loudoun.gov',
  'brooklinema.gov',
  'data.cityofrochester.gov',
  'northboroughma.gov',
  'edsource.org',
  'projects.propublica.org',
  'inyocounty.us',
  'localhistory.boulderlibrary.org',
  'anaheimobserver.com',
  'clarkcountynv.gov',
  'capistrano.navtest.catapultcms.com',
  'scstatehouse.gov',
  'datacommons.org',
  'healthequity.ucla.edu',
  'usda.gov',
  'fcmat.org',
  'encinoces.lausd.org',
  'vangoghcharter.lausd.org',
  'fortbendisd.gov',
  'pomona.pusd.org',
  'jerome2020.com',
  'stedward.org',
]);

/** lookup name (normalized) → domains to add */
const CORRECTIONS: Array<{ match: RegExp; domains: string[]; note: string }> = [
  { match: /phoenix elementary/i, domains: ['phxschools.org'], note: 'corrected from azed.gov' },
  { match: /irvine unified/i, domains: ['iusd.org'], note: 'corrected from cityofirvine.org' },
  { match: /durango school district/i, domains: ['durangoschools.org'], note: 'corrected from ballotpedia.org' },
  { match: /national elementary/i, domains: ['nsd.us'], note: 'National School District' },
  { match: /laurens county/i, domains: ['lcboe.net'], note: 'Laurens County GA' },
  { match: /rockford/i, domains: ['rps205.com'], note: 'corrected from isbe.net' },
  { match: /isucceed/i, domains: ['isucceedidaho.org'], note: 'corrected from osbe.idaho.gov' },
  { match: /parent teachers association/i, domains: ['nyspta.org'], note: 'corrected from neric.org' },
  { match: /los angeles unified/i, domains: ['lausd.net'], note: 'mega: staff mail is lausd.net' },
  { match: /new york city geographic/i, domains: ['schools.nyc.gov'], note: 'mega: NYC DOE staff mail' },
  { match: /boston public schools/i, domains: ['bostonpublicschools.org'], note: 'mega' },
  { match: /houston isd/i, domains: ['houstonisd.org'], note: 'mega' },
  { match: /metro nashville/i, domains: ['mnps.org'], note: 'mega: not nashville.gov' },
  { match: /clark county school district/i, domains: ['nv.ccsd.net', 'ccsd.net'], note: 'mega: CCSD staff mail' },
  { match: /hawaii department of education/i, domains: ['k12.hi.us'], note: 'mega: HIDOE staff mail' },
  { match: /memphis-shelby/i, domains: ['scsk12.org'], note: 'mega' },
  { match: /bellflower unified/i, domains: ['busd.k12.ca.us'], note: 'corrected from city site' },
  { match: /anderson school district 05/i, domains: ['anderson5.net'], note: 'corrected from ed.sc.gov' },
  { match: /temecula valley/i, domains: ['tvusd.us'], note: 'corrected from city site' },
  { match: /loudoun county/i, domains: ['lcps.org', 'loudoun.k12.va.us'], note: 'staff mail loudoun.k12.va.us' },
  { match: /public schools of brookline/i, domains: ['brookline.k12.ma.us'], note: 'corrected from town site' },
  { match: /rochester city school district/i, domains: ['rcsdk12.org'], note: 'corrected from city open data' },
  { match: /northborough-southborough/i, domains: ['nsboro.k12.ma.us'], note: 'corrected from town site' },
  { match: /north county joint union/i, domains: ['ncjuesd.org'], note: 'corrected from ed-data' },
  { match: /eastern suffolk boces/i, domains: ['esboces.org'], note: 'corrected from propublica' },
  { match: /owens valley/i, domains: ['ovusd.org'], note: 'corrected from county site' },
  { match: /boulder valley/i, domains: ['bvsd.org'], note: 'corrected from library archive' },
  { match: /anaheim elementary/i, domains: ['anaheimelementary.org'], note: 'corrected from local news' },
  { match: /anderson school district 03/i, domains: ['anderson3.org'], note: 'corrected from statehouse pdf' },
  { match: /des moines independent/i, domains: ['dmschools.org'], note: 'corrected from datacommons' },
  { match: /capistrano unified/i, domains: ['capousd.org'], note: 'corrected from catapult cms staging' },
  { match: /wonderful college prep/i, domains: ['wonderfulcollegeprep.org'], note: 'corrected from ed.gov pdf' },
  { match: /fenton avenue charter/i, domains: ['fentoncharter.net'], note: 'corrected from ed.gov pdf' },
  { match: /ararat charter/i, domains: ['araratcharter.org'], note: 'corrected from ed.gov pdf' },
  { match: /parnassus/i, domains: ['parnassusprep.com'], note: 'corrected from elementaryschools.org' },
  { match: /st\.? vrain/i, domains: ['svvsd.org'], note: 'corrected from elementaryschools.org' },
  { match: /big sandy/i, domains: ['bigsandy100j.com'], note: 'corrected from backgroundchecks.org' },
  { match: /^union elementary$/i, domains: ['unionsd.org'], note: 'Union SD San Jose' },
  { match: /fort bend/i, domains: ['fortbendisd.com'], note: 'staff domain' },
  { match: /pomona unified/i, domains: ['pusd.org'], note: 'normalized from pomona.pusd.org' },
  { match: /san bernardino city unified/i, domains: ['sbcusd.k12.ca.us', 'sbcusd.com'], note: 'mail + website' },
];

const PROMOTE_IF_OFFICIAL = new Set([
  'wcusd.org',
  'lpi-elpaso.org',
  'mpsaz.org',
  'boe.rale.k12.wv.us',
  'taftcityschools.com',
  'tusd1.org',
  'salkeiz.k12.or.us',
  'lancastercsd.com',
  'wsfcs.k12.nc.us',
  'brevardschools.org',
  'stbernardcatholicschool.com',
  'vvuhsd.org',
  'atasusd.org',
  'trusd.org',
  'eagleschools.net',
  'pbvusd.k12.ca.us',
  'ycsd.org',
  'vesd.net',
  'calienteschooldistrict.org',
  'aacps.org',
  'wlhs.org',
  'slcusd.org',
  'wuhsd.org',
  'smbsd.org',
  'ccusd.org',
  'wpusd.org',
  'escwr.org',
  'hawaiipublicschools.org',
  'leeschools.net',
]);

const STILL_ASK = new Set([
  'Burrel Union Elementary NH',
  'Vanguard Class School East Campus',
  'PTACH - Jewish Instructional Support',
  'Northridge Elementary',
  'St. Ann Catholic School Nashville',
  'St. Edward School',
  'JEFFERSON ELEMENTARY SCHOOL',
]);

function cleanDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/\\+$/, '').replace(/\.+$/, '');
}

type Agg = {
  accounts: Set<string>;
  scopes: Set<string>;
  confidence: string;
  notes: Set<string>;
};

function add(
  map: Map<string, Agg>,
  domain: string,
  account: string,
  scope: string,
  confidence: string,
  note: string,
): void {
  const d = cleanDomain(domain);
  if (!d || JUNK.has(d)) return;
  const existing = map.get(d);
  if (!existing) {
    map.set(d, {
      accounts: new Set(account ? [account] : []),
      scopes: new Set(scope ? [scope] : []),
      confidence,
      notes: new Set(note ? [note] : []),
    });
    return;
  }
  if (account) existing.accounts.add(account);
  if (scope) existing.scopes.add(scope);
  if (note) existing.notes.add(note);
  if (confidence === 'high') existing.confidence = 'high';
}

export function foldRun(runDir: string): { kept: number; dropped: number; added: number; remainingAsk: number } {
  const unique = readCsv(join(runDir, 'unique_domains.csv'));
  const lookups = readCsv(join(runDir, 'lookup_results.csv'));
  const accounts = readCsv(join(runDir, 'accounts.csv'));
  const ask = readCsv(join(runDir, 'ask_queue.csv'));

  const out = new Map<string, Agg>();
  let dropped = 0;
  for (const row of unique) {
    const domain = cleanDomain(row.domain);
    if (!domain || JUNK.has(domain)) {
      dropped += 1;
      continue;
    }
    add(out, domain, '', row.scope, row.confidence, row.notes);
    for (const acc of (row.source_accounts ?? '').split('|')) {
      if (acc) out.get(domain)?.accounts.add(acc);
    }
  }

  let added = 0;
  const before = new Set(out.keys());

  for (const lookup of lookups) {
    const host = cleanDomain(lookup.chosen_domain || lookup.website_host);
    if (host && PROMOTE_IF_OFFICIAL.has(host)) {
      add(out, host, lookup.name, lookup.kind, 'medium', 'promoted official site (no emails on page)');
    }
    for (const rule of CORRECTIONS) {
      if (rule.match.test(lookup.name)) {
        for (const domain of rule.domains) {
          add(out, domain, lookup.name, lookup.kind, 'high', rule.note);
        }
      }
    }
  }

  for (const domain of out.keys()) {
    if (!before.has(domain)) added += 1;
  }

  const remaining = ask.filter((row) => STILL_ASK.has(row.account_name));

  const uniqueRows = [...out.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, v]) =>
      rowToRecord({
        domain,
        type: 'domain',
        source_accounts: [...v.accounts].sort().join('|'),
        scope: [...v.scopes].sort().join('|'),
        confidence: v.confidence,
        notes: [...v.notes].slice(0, 3).join(' | '),
      }),
    );

  writeCsv(join(runDir, 'unique_domains.csv'), uniqueRows, [
    'domain',
    'type',
    'source_accounts',
    'scope',
    'confidence',
    'notes',
  ]);
  writeCsv(
    join(runDir, 'block_list_domains.csv'),
    uniqueRows.map((r) => ({ domain: r.domain, type: 'domain' })),
    ['domain', 'type'],
  );
  writeCsv(
    join(runDir, 'ask_remaining.csv'),
    remaining,
    [
      'account_name',
      'parent_account',
      'city',
      'state',
      'website',
      'extracted_emails',
      'candidate_domains',
      'reason',
      'notes',
    ],
  );
  writeJson(join(runDir, 'fold_summary.json'), {
    unique_domains: uniqueRows.length,
    dropped_junk: dropped,
    added_corrections: added,
    remaining_ask: remaining.length,
    remaining_names: remaining.map((r) => r.account_name),
  });
  console.log(
    JSON.stringify(
      {
        unique_domains: uniqueRows.length,
        dropped_junk: dropped,
        added_corrections: added,
        remaining_ask: remaining.length,
      },
      null,
      2,
    ),
  );
  return {
    kept: uniqueRows.length,
    dropped,
    added,
    remainingAsk: remaining.length,
  };
}

async function main(): Promise<void> {
  const cli = parseCliArgs();
  const runDir = resolve(cli.runDir ?? join(packageRoot, 'output/runs/full-1'));
  foldRun(runDir);
}

if (process.argv[1]?.includes('fold.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
