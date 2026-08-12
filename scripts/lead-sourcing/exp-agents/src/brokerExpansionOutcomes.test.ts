import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ingestLicenseFile } from './licenses/ingest.ts';
import { matchLicensesToMaster } from './licenses/matchToMaster.ts';
import {
  buildBrokerLeadRows,
  mergeLicenseMatches,
  mergeRosterCaptures,
} from './mergeBrokerExpansion.ts';
import type { MasterAgent } from './rosterMatch.ts';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'licenses');

describe('broker expansion licensing outcomes', () => {
  it('ingests CA/TX/FL fixtures and upgrades matched eXp agents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'exp-license-'));
    try {
      const ca = ingestLicenseFile({
        source: 'ca_dre',
        inputPath: join(FIXTURES, 'ca_sample.csv'),
        runDir: dir,
        sourceUrl: 'fixture://ca',
      });
      const tx = ingestLicenseFile({
        source: 'tx_trec',
        inputPath: join(FIXTURES, 'tx_sample.csv'),
        runDir: dir,
        sourceUrl: 'fixture://tx',
      });
      const fl = ingestLicenseFile({
        source: 'fl_dbpr',
        inputPath: join(FIXTURES, 'fl_sample.csv'),
        runDir: dir,
        sourceUrl: 'fixture://fl',
      });
      assert.ok(ca.meta.sha256.length === 64);
      assert.ok(tx.records.some((row) => row.designatedSupervisor));
      assert.ok(fl.records.some((row) => /broker/i.test(row.licenseType)));

      const master: MasterAgent[] = [
        {
          id: 'tx-1',
          first_name: 'Casey',
          last_name: 'Supervisor',
          email: 'casey@example.com',
          phone: '5125550100',
          city: 'Austin',
          state: 'TX',
          country: 'US',
          bio: '',
        },
        {
          id: 'fl-1',
          first_name: 'Luz',
          last_name: 'Abreu',
          email: 'luz@example.com',
          phone: '',
          city: 'Miami',
          state: 'FL',
          country: 'US',
          bio: '',
        },
      ];
      const licenses = [...ca.records, ...tx.records, ...fl.records];
      const matched = matchLicensesToMaster(master, licenses);
      const roster = mergeRosterCaptures({
        master,
        captures: [],
        manifest: null,
      });
      mergeLicenseMatches(
        roster.byMaster,
        new Map(master.map((row) => [row.id, row])),
        matched.matches,
      );
      const rows = buildBrokerLeadRows(roster.byMaster);
      assert.ok(rows.some((row) => row.master_id === 'tx-1' && row.audience_tier === 'A'));
      assert.ok(rows.some((row) => row.master_id === 'fl-1' && row.audience_tier === 'C'));
      assert.equal(new Set(rows.map((row) => row.master_id)).size, rows.length);
      for (const row of rows) assert.ok(row.evidence.trim());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
