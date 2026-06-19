import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  nextCampaignJobScheduledAtAfterOooResume,
  threadRowIsDueForOooResumeProcessing,
} from './outOfOfficeResumeRules';

describe('threadRowIsDueForOooResumeProcessing', () => {
  const base = {
    oooResumeRequested: true,
    outOfOffice: true,
    oooResumeProcessedAt: null as string | null,
    enrollmentId: 'e1',
    oooResumeAt: '2026-04-29T10:00:00.000Z',
  };
  const now = new Date('2026-04-29T12:00:00.000Z');

  it('is true when resume time is in the past', () => {
    assert.equal(threadRowIsDueForOooResumeProcessing({ ...base, now }), true);
  });

  it('is false when resume time is in the future', () => {
    assert.equal(
      threadRowIsDueForOooResumeProcessing({
        ...base,
        oooResumeAt: '2026-04-30T00:00:00.000Z',
        now,
      }),
      false
    );
  });

  it('is false when already processed', () => {
    assert.equal(
      threadRowIsDueForOooResumeProcessing({
        ...base,
        oooResumeProcessedAt: '2026-04-29T11:00:00.000Z',
        now,
      }),
      false
    );
  });

  it('is false when resume not requested', () => {
    assert.equal(
      threadRowIsDueForOooResumeProcessing({
        ...base,
        oooResumeRequested: false,
        now,
      }),
      false
    );
  });

  it('is false without enrollment', () => {
    assert.equal(
      threadRowIsDueForOooResumeProcessing({
        ...base,
        enrollmentId: null,
        now,
      }),
      false
    );
  });
});

describe('nextCampaignJobScheduledAtAfterOooResume', () => {
  const notBefore = new Date('2026-04-29T15:00:00.000Z');
  const floorPlus30 = new Date('2026-04-29T15:00:30.000Z');

  it('bumps job when scheduled before floor+30s', () => {
    const jobAt = new Date('2026-04-29T14:00:00.000Z');
    const next = nextCampaignJobScheduledAtAfterOooResume({
      jobScheduledAt: jobAt,
      resumeNotBefore: notBefore,
    });
    assert.strictEqual(next.toISOString(), floorPlus30.toISOString());
  });

  it('keeps job time when already after floor+30s', () => {
    const jobAt = new Date('2026-04-30T09:00:00.000Z');
    const next = nextCampaignJobScheduledAtAfterOooResume({
      jobScheduledAt: jobAt,
      resumeNotBefore: notBefore,
    });
    assert.strictEqual(next.toISOString(), jobAt.toISOString());
  });
});
