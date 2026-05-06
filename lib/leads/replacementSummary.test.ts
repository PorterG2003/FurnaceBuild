import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyLeadReplacementSummary,
  buildLeadReplacementSummariesByLeadIds,
  type LeadReplacementCounterpart,
  type LeadReplacementRow,
  type LeadReplacementSummary,
} from './replacementSummary';

test('applyLeadReplacementSummary returns null fields when summary is missing', () => {
  assert.deepEqual(applyLeadReplacementSummary(null), {
    replacement_role: null,
    replacement_counterpart_lead_id: null,
    replacement_counterpart_name: null,
    replacement_counterpart_email: null,
    replacement_counterpart_label: null,
    replacement_reason: null,
    replacement_reason_note: null,
    replacement_completed_at: null,
  });
});

test('applyLeadReplacementSummary projects populated summary fields', () => {
  const summary: LeadReplacementSummary = {
    replacementId: 'replacement-1',
    role: 'new',
    counterpartLeadId: 'lead-old',
    counterpartName: 'Old Lead',
    counterpartEmail: 'old@example.com',
    counterpartLabel: 'Old Lead',
    reason: 'manual_referral',
    reasonNote: 'OOO pointed me elsewhere',
    completedAt: '2026-05-05T20:00:00.000Z',
    createdAt: '2026-05-05T19:00:00.000Z',
  };

  assert.deepEqual(applyLeadReplacementSummary(summary), {
    replacement_role: 'new',
    replacement_counterpart_lead_id: 'lead-old',
    replacement_counterpart_name: 'Old Lead',
    replacement_counterpart_email: 'old@example.com',
    replacement_counterpart_label: 'Old Lead',
    replacement_reason: 'manual_referral',
    replacement_reason_note: 'OOO pointed me elsewhere',
    replacement_completed_at: '2026-05-05T20:00:00.000Z',
  });
});

test('buildLeadReplacementSummariesByLeadIds assigns old and new roles when both leads are in scope', () => {
  const replacement: LeadReplacementRow = {
    id: 'replacement-1',
    old_lead_id: 'lead-old',
    new_lead_id: 'lead-new',
    reason: 'manual_referral',
    reason_note: 'retired',
    created_at: '2026-05-05T19:00:00.000Z',
    completed_at: '2026-05-05T20:00:00.000Z',
  };
  const counterpartLeadsById = new Map<string, LeadReplacementCounterpart>([
    [
      'lead-old',
      {
        id: 'lead-old',
        name: 'Alice Old',
        first_name: 'Alice',
        last_name: 'Old',
        email: 'alice.old@example.com',
      },
    ],
    [
      'lead-new',
      {
        id: 'lead-new',
        name: 'Bob New',
        first_name: 'Bob',
        last_name: 'New',
        email: 'bob.new@example.com',
      },
    ],
  ]);

  const summaries = buildLeadReplacementSummariesByLeadIds({
    leadIds: ['lead-old', 'lead-new'],
    replacements: [replacement],
    counterpartLeadsById,
  });

  assert.equal(summaries['lead-old']?.role, 'old');
  assert.equal(summaries['lead-old']?.counterpartLeadId, 'lead-new');
  assert.equal(summaries['lead-old']?.counterpartLabel, 'Bob New');
  assert.equal(summaries['lead-new']?.role, 'new');
  assert.equal(summaries['lead-new']?.counterpartLeadId, 'lead-old');
  assert.equal(summaries['lead-new']?.counterpartLabel, 'Alice Old');
});

test('buildLeadReplacementSummariesByLeadIds only returns the in-scope side of a replacement', () => {
  const summaries = buildLeadReplacementSummariesByLeadIds({
    leadIds: ['lead-new'],
    replacements: [
      {
        id: 'replacement-1',
        old_lead_id: 'lead-old',
        new_lead_id: 'lead-new',
        reason: 'wrong_contact',
        reason_note: null,
        created_at: '2026-05-05T19:00:00.000Z',
        completed_at: '2026-05-05T20:00:00.000Z',
      },
    ],
    counterpartLeadsById: new Map([
      [
        'lead-old',
        {
          id: 'lead-old',
          name: 'Alice Old',
          first_name: 'Alice',
          last_name: 'Old',
          email: 'alice.old@example.com',
        },
      ],
      [
        'lead-new',
        {
          id: 'lead-new',
          name: 'Bob New',
          first_name: 'Bob',
          last_name: 'New',
          email: 'bob.new@example.com',
        },
      ],
    ]),
  });

  assert.deepEqual(Object.keys(summaries), ['lead-new']);
  assert.equal(summaries['lead-new']?.role, 'new');
});

test('buildLeadReplacementSummariesByLeadIds falls back from name to first/last to email and dedupes by lead id', () => {
  const replacementA: LeadReplacementRow = {
    id: 'replacement-1',
    old_lead_id: 'lead-old',
    new_lead_id: 'lead-new',
    reason: 'role_change',
    reason_note: null,
    created_at: '2026-05-05T19:00:00.000Z',
    completed_at: '2026-05-05T20:00:00.000Z',
  };
  const replacementB: LeadReplacementRow = {
    ...replacementA,
    id: 'replacement-2',
    reason_note: 'latest row wins',
  };

  const summaries = buildLeadReplacementSummariesByLeadIds({
    leadIds: ['lead-old', 'lead-new'],
    replacements: [replacementA, replacementB],
    counterpartLeadsById: new Map([
      [
        'lead-old',
        {
          id: 'lead-old',
          name: null,
          first_name: null,
          last_name: null,
          email: 'old@example.com',
        },
      ],
      [
        'lead-new',
        {
          id: 'lead-new',
          name: null,
          first_name: 'Bob',
          last_name: 'New',
          email: 'new@example.com',
        },
      ],
    ]),
  });

  assert.deepEqual(Object.keys(summaries).sort(), ['lead-new', 'lead-old']);
  assert.equal(summaries['lead-old']?.counterpartLabel, 'Bob New');
  assert.equal(summaries['lead-new']?.counterpartLabel, 'old@example.com');
  assert.equal(summaries['lead-old']?.reasonNote, 'latest row wins');
  assert.equal(summaries['lead-new']?.reasonNote, 'latest row wins');
});
