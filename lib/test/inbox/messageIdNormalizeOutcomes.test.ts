import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessageId } from '@furnace/email-lib';
import { CampaignDbHarness } from '../campaign/harness';
import { createCampaignTestNamespace } from '../campaign/fixtures';

const PARITY_CASES: Array<{ raw: string | null; label: string }> = [
  { raw: '<a@b.com>', label: 'bracketed' },
  { raw: 'a@b.com', label: 'bare' },
  { raw: '  <A@B.com>  ', label: 'spaced mixed-case' },
  { raw: '<<a@b.com>>', label: 'double brackets' },
  { raw: '', label: 'empty' },
  { raw: 'not-an-id', label: 'invalid' },
  { raw: null, label: 'null' },
];

function isMissingNormalizeRpc(message: string | undefined): boolean {
  return !!message && /could not find|schema cache|does not exist|PGRST202/i.test(message);
}

test('normalize_rfc5322_message_id matches JS normalizeMessageId', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('msgid-norm'),
  });

  try {
    const probe = await harness.supabase.rpc('normalize_rfc5322_message_id', {
      p_raw: 'a@b.com',
    });
    if (probe.error && isMissingNormalizeRpc(probe.error.message)) {
      t.skip(`normalize_rfc5322_message_id not applied: ${probe.error.message}`);
      return;
    }
    assert.equal(probe.error, null, probe.error?.message);
    assert.equal(probe.data, 'a@b.com');

    for (const { raw, label } of PARITY_CASES) {
      const { data, error } = await harness.supabase.rpc('normalize_rfc5322_message_id', {
        p_raw: raw,
      });
      assert.equal(error, null, `${label}: ${error?.message}`);
      assert.equal(data, normalizeMessageId(raw), label);
    }
  } finally {
    await harness.cleanup();
  }
});
