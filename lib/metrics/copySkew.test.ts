import assert from 'node:assert/strict';
import test from 'node:test';
import { compareCopyStatsReliability, copySkewWarnings } from './copySkew';

test('copySkewWarnings reports each disclosed confound', () => {
  const warnings = copySkewWarnings({
    sent: 42,
    positive_reply: 7,
    distinct_contents: 1,
    distinct_nodes: 3,
    top_campaign_sent: 40,
  });
  assert.deepEqual(
    warnings.map((warning) => warning.code),
    ['low_volume', 'one_email', 'concentrated_campaign', 'mixed_sequence_positions'],
  );
});

test('campaign concentration starts at eighty percent', () => {
  const base = {
    sent: 100,
    positive_reply: 5,
    distinct_contents: 2,
    distinct_nodes: 1,
  };
  assert.ok(
    copySkewWarnings({ ...base, top_campaign_sent: 80 }).some(
      (warning) => warning.code === 'concentrated_campaign',
    ),
  );
  assert.ok(
    !copySkewWarnings({ ...base, top_campaign_sent: 79 }).some(
      (warning) => warning.code === 'concentrated_campaign',
    ),
  );
});

test('reliable rows rank by positive rate before low-volume rows', () => {
  const rows = [
    {
      sent: 25,
      positive_reply: 20,
      distinct_contents: 1,
      distinct_nodes: 1,
      top_campaign_sent: 25,
    },
    {
      sent: 200,
      positive_reply: 10,
      distinct_contents: 2,
      distinct_nodes: 1,
      top_campaign_sent: 100,
    },
    {
      sent: 100,
      positive_reply: 10,
      distinct_contents: 2,
      distinct_nodes: 1,
      top_campaign_sent: 50,
    },
  ].sort(compareCopyStatsReliability);

  assert.deepEqual(rows.map((row) => row.sent), [100, 200, 25]);
});
