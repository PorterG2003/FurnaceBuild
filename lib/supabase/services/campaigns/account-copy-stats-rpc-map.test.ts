import assert from 'node:assert/strict';
import test from 'node:test';
import { mapAccountCopyStatsPayload } from './account-copy-stats-rpc-map';

test('maps copy stats payload and coerces Postgres count strings', () => {
  const result = mapAccountCopyStatsPayload({
    rows: [
      {
        id: 'archetype-1',
        kind: 'hook',
        name: 'Pain-led opener',
        description: 'Starts with the prospect problem.',
        sent: '120',
        replied: '18',
        ooo_replied: '4',
        positive_reply: '7',
        bounce: '2',
        campaigns: '3',
        distinct_contents: '4',
        distinct_nodes: '2',
        top_campaign_sent: '70',
        wordings: [
          {
            piece_id: 'piece-1',
            raw_text: '{Seeing|Noticed} {{company_name}} is hiring.',
            display_text: 'Seeing is hiring.',
          },
        ],
        campaign_names: ['Campaign A', 'Campaign B'],
        node_labels: ['Email 1'],
      },
    ],
    attributed_sends: '120',
    unattributed_sends: '5',
    copy_backlog: '2',
    failed_contents: '1',
  });

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], {
    id: 'archetype-1',
    kind: 'hook',
    name: 'Pain-led opener',
    description: 'Starts with the prospect problem.',
    sent: 120,
    replied: 18,
    ooo_replied: 4,
    positive_reply: 7,
    bounce: 2,
    campaigns: 3,
    distinct_contents: 4,
    distinct_nodes: 2,
    top_campaign_sent: 70,
    wordings: [
      {
        piece_id: 'piece-1',
        raw_text: '{Seeing|Noticed} {{company_name}} is hiring.',
        display_text: 'Seeing is hiring.',
      },
    ],
    campaign_names: ['Campaign A', 'Campaign B'],
    node_labels: ['Email 1'],
  });
  assert.equal(result.attributedSends, 120);
  assert.equal(result.unattributedSends, 5);
  assert.equal(result.copyBacklog, 2);
  assert.equal(result.failedContents, 1);
});

test('drops malformed rows, kinds, and wording identities', () => {
  const result = mapAccountCopyStatsPayload({
    rows: [
      null,
      { id: 'bad-kind', kind: 'headline', name: 'Nope' },
      { id: '', kind: 'hook', name: 'Missing identity' },
      {
        id: 'piece-1',
        kind: 'cta',
        name: 'Question',
        sent: 'not-a-number',
        wordings: [{ raw_text: 'Interested?', display_text: 'Interested?' }],
        campaign_names: ['Campaign A', 42],
      },
    ],
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.sent, 0);
  assert.equal(result.rows[0]?.ooo_replied, 0);
  assert.deepEqual(result.rows[0]?.wordings, []);
  assert.deepEqual(result.rows[0]?.campaign_names, ['Campaign A']);
  assert.equal(result.copyBacklog, 0);
});
