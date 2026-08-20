import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupCopyStatsByKind,
  copyStatCell,
  formatCopyStatPct,
  leaderboardBarFraction,
} from './copyLeaderboard';
import type { AccountCopyStatRow } from '../supabase/services/campaigns/account-copy-stats-rpc-map';

function makeRow(
  overrides: Partial<AccountCopyStatRow> & Pick<AccountCopyStatRow, 'id' | 'kind' | 'name'>,
): AccountCopyStatRow {
  return {
    description: null,
    sent: 0,
    replied: 0,
    ooo_replied: 0,
    positive_reply: 0,
    bounce: 0,
    campaigns: 1,
    distinct_contents: 1,
    distinct_nodes: 1,
    top_campaign_sent: 0,
    wordings: [],
    campaign_names: [],
    node_labels: [],
    ...overrides,
  };
}

test('groups are emitted in COPY_PIECE_KINDS order and empty kinds are dropped', () => {
  const rows: AccountCopyStatRow[] = [
    makeRow({ id: 'c1', kind: 'cta', name: 'Question CTA', sent: 50 }),
    makeRow({ id: 'h1', kind: 'hook', name: 'Pain hook', sent: 200, positive_reply: 10 }),
    makeRow({ id: 'c2', kind: 'cta', name: 'Calendar CTA', sent: 80 }),
  ];
  const groups = groupCopyStatsByKind(rows);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].kind, 'hook');
  assert.equal(groups[1].kind, 'cta');
});

test('rows within a group are sorted by reliability then rate', () => {
  const rows: AccountCopyStatRow[] = [
    makeRow({ id: 'h1', kind: 'hook', name: 'Lucky small', sent: 20, positive_reply: 5 }),
    makeRow({ id: 'h2', kind: 'hook', name: 'Reliable best', sent: 200, positive_reply: 20 }),
    makeRow({ id: 'h3', kind: 'hook', name: 'Reliable mid', sent: 150, positive_reply: 10 }),
  ];
  const groups = groupCopyStatsByKind(rows);
  assert.equal(groups[0].rows[0].id, 'h2', 'reliable best first');
  assert.equal(groups[0].rows[1].id, 'h3', 'reliable mid second');
  assert.equal(groups[0].rows[2].id, 'h1', 'unreliable last despite higher rate');
});

test('totalSent sums all rows in the group', () => {
  const rows: AccountCopyStatRow[] = [
    makeRow({ id: 'h1', kind: 'hook', name: 'A', sent: 100 }),
    makeRow({ id: 'h2', kind: 'hook', name: 'B', sent: 250 }),
  ];
  const groups = groupCopyStatsByKind(rows);
  assert.equal(groups[0].totalSent, 350);
});

test('bestInterestedPerSend uses only reliable rows', () => {
  const rows: AccountCopyStatRow[] = [
    makeRow({ id: 'h1', kind: 'hook', name: 'Lucky', sent: 10, positive_reply: 5 }),
    makeRow({ id: 'h2', kind: 'hook', name: 'Solid', sent: 200, positive_reply: 20 }),
  ];
  const groups = groupCopyStatsByKind(rows);
  assert.equal(groups[0].bestInterestedPerSend, 20 / 200);
});

test('bestInterestedPerSend is 0 when no rows are reliable', () => {
  const rows: AccountCopyStatRow[] = [
    makeRow({ id: 'h1', kind: 'hook', name: 'Tiny', sent: 5, positive_reply: 2 }),
  ];
  const groups = groupCopyStatsByKind(rows);
  assert.equal(groups[0].bestInterestedPerSend, 0);
});

test('copyStatCell returns null pct on zero denominator', () => {
  const cell = copyStatCell(5, 0);
  assert.equal(cell.count, 5);
  assert.equal(cell.pct, null);
  assert.equal(cell.reliable, false);
});

test('copyStatCell returns pct and reliable flag', () => {
  const cell = copyStatCell(15, 200);
  assert.equal(cell.count, 15);
  assert.equal(cell.pct, 7.5);
  assert.equal(cell.reliable, true);
});

test('copyStatCell rounds to two decimal places', () => {
  assert.equal(copyStatCell(1, 300).pct, 0.33);
  assert.equal(copyStatCell(8, 1847).pct, 0.43);
});

test('copyStatCell marks unreliable below 100 sends', () => {
  const cell = copyStatCell(3, 50);
  assert.equal(cell.reliable, false);
  assert.equal(cell.pct, 6);
});

test('formatCopyStatPct keeps two decimals and uses an em dash when missing', () => {
  assert.equal(formatCopyStatPct(null), '—');
  assert.equal(formatCopyStatPct(7.5), '7.50%');
  assert.equal(formatCopyStatPct(0.43), '0.43%');
  assert.equal(formatCopyStatPct(6), '6.00%');
  assert.equal(formatCopyStatPct(0), '0.00%');
});

test('leaderboardBarFraction is clamped to [0, 1]', () => {
  const row = makeRow({ id: 'h1', kind: 'hook', name: 'Best', sent: 200, positive_reply: 20 });
  const group = {
    kind: 'hook' as const,
    label: 'Hooks',
    rows: [row],
    pieceCount: 1,
    totalSent: 200,
    bestInterestedPerSend: 0.1,
  };
  assert.equal(leaderboardBarFraction(row, group), 1);
});

test('leaderboardBarFraction is 0 when group best is 0', () => {
  const row = makeRow({ id: 'h1', kind: 'hook', name: 'No data', sent: 10, positive_reply: 3 });
  const group = {
    kind: 'hook' as const,
    label: 'Hooks',
    rows: [row],
    pieceCount: 1,
    totalSent: 10,
    bestInterestedPerSend: 0,
  };
  assert.equal(leaderboardBarFraction(row, group), 0);
});

test('leaderboardBarFraction is 0 when row has zero sends', () => {
  const row = makeRow({ id: 'h1', kind: 'hook', name: 'Zero', sent: 0, positive_reply: 0 });
  const group = {
    kind: 'hook' as const,
    label: 'Hooks',
    rows: [row],
    pieceCount: 1,
    totalSent: 0,
    bestInterestedPerSend: 0.1,
  };
  assert.equal(leaderboardBarFraction(row, group), 0);
});

test('leaderboardBarFraction scales proportionally', () => {
  const row = makeRow({ id: 'h1', kind: 'hook', name: 'Half', sent: 200, positive_reply: 10 });
  const group = {
    kind: 'hook' as const,
    label: 'Hooks',
    rows: [row],
    pieceCount: 1,
    totalSent: 200,
    bestInterestedPerSend: 0.1,
  };
  assert.equal(leaderboardBarFraction(row, group), 0.5);
});

test('empty input produces no groups', () => {
  assert.deepEqual(groupCopyStatsByKind([]), []);
});
