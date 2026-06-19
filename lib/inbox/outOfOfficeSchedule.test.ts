import assert from 'node:assert';
import { describe, it } from 'node:test';
import { computeOooQuickResumeAtIso, computeOooResumeAtIso, utcNoonIsoFromYmd } from './outOfOfficeSchedule';

describe('utcNoonIsoFromYmd', () => {
  it('returns UTC noon ISO for valid YYYY-MM-DD', () => {
    assert.strictEqual(utcNoonIsoFromYmd('2026-05-12'), '2026-05-12T12:00:00.000Z');
  });

  it('rejects bad format', () => {
    assert.strictEqual(utcNoonIsoFromYmd('05/12/2026'), null);
    assert.strictEqual(utcNoonIsoFromYmd(''), null);
  });
});

describe('computeOooResumeAtIso', () => {
  const fixedNow = new Date('2026-04-29T15:00:00.000Z');

  it('returns null when resume campaign is off', () => {
    assert.strictEqual(
      computeOooResumeAtIso({
        resumeCampaign: false,
        mode: 'return_date',
        returnDateYmd: '2026-05-01',
        instantNow: fixedNow,
      }),
      null
    );
  });

  it('return_date mode uses UTC noon on that calendar day', () => {
    assert.strictEqual(
      computeOooResumeAtIso({
        resumeCampaign: true,
        mode: 'return_date',
        returnDateYmd: ' 2026-05-12 ',
        instantNow: fixedNow,
      }),
      '2026-05-12T12:00:00.000Z'
    );
  });

  it('instant mode uses wall clock ISO (for RPC immediate resume)', () => {
    assert.strictEqual(
      computeOooResumeAtIso({
        resumeCampaign: true,
        mode: 'instant',
        returnDateYmd: '',
        instantNow: fixedNow,
      }),
      '2026-04-29T15:00:00.000Z'
    );
  });

  it('return_date returns null when ymd empty', () => {
    assert.strictEqual(
      computeOooResumeAtIso({
        resumeCampaign: true,
        mode: 'return_date',
        returnDateYmd: '   ',
        instantNow: fixedNow,
      }),
      null
    );
  });
});

describe('computeOooQuickResumeAtIso', () => {
  const fixedNow = new Date('2026-04-29T15:00:00.000Z');

  it('dated preset uses UTC noon on the chosen day', () => {
    assert.strictEqual(
      computeOooQuickResumeAtIso({
        preset: 'dated',
        returnDateYmd: '2026-05-12',
        instantNow: fixedNow,
      }),
      '2026-05-12T12:00:00.000Z'
    );
  });

  it('month preset uses 30 days from now', () => {
    assert.strictEqual(
      computeOooQuickResumeAtIso({
        preset: 'month',
        instantNow: fixedNow,
      }),
      '2026-05-29T15:00:00.000Z'
    );
  });

  it('instant preset uses the current instant', () => {
    assert.strictEqual(
      computeOooQuickResumeAtIso({
        preset: 'instant',
        instantNow: fixedNow,
      }),
      '2026-04-29T15:00:00.000Z'
    );
  });
});
