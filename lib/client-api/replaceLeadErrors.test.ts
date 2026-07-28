import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isReplacementReason,
  mapReplaceLeadRpcError,
  throwIfReplaceLeadRpcError,
} from './replaceLeadErrors.js';
import { ClientApiError } from './errors.js';
import { buildReplaceLeadPreviewPayload } from './replaceLeadPreview.js';

test('mapReplaceLeadRpcError maps lead not found to 404', () => {
  const mapped = mapReplaceLeadRpcError('Lead not found or already removed');
  assert.equal(mapped?.status, 404);
  assert.equal(mapped?.code, 'lead_not_found');
});

test('mapReplaceLeadRpcError maps already replaced to 409', () => {
  const mapped = mapReplaceLeadRpcError('Lead already has a replacement');
  assert.equal(mapped?.status, 409);
  assert.equal(mapped?.code, 'lead_already_replaced');
});

test('mapReplaceLeadRpcError maps same email to 400 with param', () => {
  const mapped = mapReplaceLeadRpcError(
    'Replacement email must differ from the original lead email',
  );
  assert.equal(mapped?.status, 400);
  assert.equal(mapped?.code, 'same_as_current_lead');
  assert.equal(mapped?.param, 'new_email');
});

test('mapReplaceLeadRpcError maps missing enrollment to 409 with preview hint', () => {
  const mapped = mapReplaceLeadRpcError(
    'Existing contact someone@example.com has no active enrollment in this campaign; launch the campaign or re-add the contact before replacing',
  );
  assert.equal(mapped?.status, 409);
  assert.equal(mapped?.code, 'target_missing_enrollment');
  assert.match(mapped?.message ?? '', /replace-lead\/preview/);
});

test('mapReplaceLeadRpcError maps target already replaced to 409', () => {
  const mapped = mapReplaceLeadRpcError(
    'Existing contact someone@example.com has already been replaced by someone else',
  );
  assert.equal(mapped?.status, 409);
  assert.equal(mapped?.code, 'target_already_replaced');
});

test('mapReplaceLeadRpcError maps forbidden and membership to 403', () => {
  assert.equal(mapReplaceLeadRpcError('Forbidden')?.code, 'forbidden');
  assert.equal(mapReplaceLeadRpcError('Account membership required')?.status, 403);
});

test('mapReplaceLeadRpcError maps invalid source message to 400', () => {
  const mapped = mapReplaceLeadRpcError('source_message_id does not belong to this account');
  assert.equal(mapped?.status, 400);
  assert.equal(mapped?.code, 'invalid_source_message');
  assert.equal(mapped?.param, 'source_message_id');
});

test('mapReplaceLeadRpcError returns null for unrecognized errors', () => {
  assert.equal(mapReplaceLeadRpcError('connection reset'), null);
});

test('throwIfReplaceLeadRpcError throws ClientApiError for mapped messages', () => {
  assert.throws(
    () => throwIfReplaceLeadRpcError('Lead already has a replacement'),
    (err: unknown) =>
      err instanceof ClientApiError
      && err.status === 409
      && err.payload.error.code === 'lead_already_replaced',
  );
});

test('throwIfReplaceLeadRpcError is a no-op for unrecognized messages', () => {
  assert.doesNotThrow(() => throwIfReplaceLeadRpcError('connection reset'));
});

test('isReplacementReason accepts known enum values', () => {
  assert.equal(isReplacementReason('manual_referral'), true);
  assert.equal(isReplacementReason('not_a_reason'), false);
});

test('buildReplaceLeadPreviewPayload derives created mode when no match', () => {
  const preview = buildReplaceLeadPreviewPayload({
    email: 'new@example.com',
    duplicateCount: 0,
    existingLead: null,
    blocked: false,
    blockReason: null,
    matchesOldLead: false,
  });
  assert.equal(preview.mode, 'created');
  assert.equal(preview.allowed, true);
  assert.equal(preview.disallowed_reason, null);
  assert.equal(preview.existing_lead, null);
});

test('buildReplaceLeadPreviewPayload derives attached mode and enrollment guard', () => {
  const preview = buildReplaceLeadPreviewPayload({
    email: 'existing@example.com',
    duplicateCount: 2,
    existingLead: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'existing@example.com',
      name: 'Existing',
      firstName: 'Ex',
      lastName: 'Isting',
      phoneNumber: null,
      mobilePhoneNumber: null,
      companyName: 'Acme',
      website: null,
      linkedinUrl: null,
      companyLinkedinUrl: null,
      customLeadData: { region: 'east' },
      enrollmentId: null,
      enrollmentState: null,
      hasBeenContacted: true,
      lastActivityAt: '2026-07-01T00:00:00.000Z',
    },
    blocked: true,
    blockReason: 'unsubscribed',
    matchesOldLead: false,
  });
  assert.equal(preview.mode, 'attached');
  assert.equal(preview.allowed, false);
  assert.equal(preview.disallowed_reason, 'target_missing_enrollment');
  assert.equal(preview.match_count, 2);
  assert.equal(preview.blocked, true);
  assert.equal(preview.block_reason, 'unsubscribed');
  assert.equal(preview.existing_lead?.company_name, 'Acme');
  assert.deepEqual(preview.existing_lead?.custom_lead_data, { region: 'east' });
});

test('buildReplaceLeadPreviewPayload marks same-as-current as disallowed', () => {
  const preview = buildReplaceLeadPreviewPayload({
    email: 'same@example.com',
    duplicateCount: 0,
    existingLead: null,
    blocked: false,
    blockReason: null,
    matchesOldLead: true,
  });
  assert.equal(preview.allowed, false);
  assert.equal(preview.disallowed_reason, 'same_as_current_lead');
  assert.equal(preview.matches_current_lead, true);
});
