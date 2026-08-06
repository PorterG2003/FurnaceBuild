import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractEmailsFromHeaderText,
  headerText,
  planRecipientBackfill,
} from './backfill-email-message-recipients-helpers.js';

describe('extractEmailsFromHeaderText', () => {
  it('parses angled and bare addresses', () => {
    assert.deepEqual(
      extractEmailsFromHeaderText('"Brian Jenkins" <brian@bravarasport.com>'),
      ['brian@bravarasport.com']
    );
    assert.deepEqual(
      extractEmailsFromHeaderText(
        '"A" <a@x.com>, b@y.com, "C" <C@Z.com>'
      ),
      ['a@x.com', 'b@y.com', 'C@Z.com']
    );
    assert.deepEqual(extractEmailsFromHeaderText('recreational@coloradounitedsoccer.com'), [
      'recreational@coloradounitedsoccer.com',
    ]);
    assert.deepEqual(extractEmailsFromHeaderText('"stephanieso@trynexttherapist.com"'), [
      'stephanieso@trynexttherapist.com',
    ]);
    assert.deepEqual(extractEmailsFromHeaderText(''), []);
    assert.deepEqual(extractEmailsFromHeaderText(null), []);
  });
});

describe('headerText', () => {
  it('reads case-insensitive keys and joins arrays', () => {
    assert.equal(headerText({ Cc: 'a@x.com' }, 'cc'), 'a@x.com');
    assert.equal(headerText({ to: ['a@x.com', 'b@y.com'] }, 'to'), 'a@x.com, b@y.com');
    assert.equal(headerText({}, 'cc'), null);
  });
});

describe('planRecipientBackfill', () => {
  it('fills to_emails from headers and cc when columns are null', () => {
    const plan = planRecipientBackfill({
      toEmail: 'primary@example.com',
      toEmails: null,
      cc: null,
      headers: {
        to: '"Primary" <primary@example.com>, other@example.com',
        cc: 'cc@example.com',
      },
    });
    assert.deepEqual(plan.toEmails, ['primary@example.com', 'other@example.com']);
    assert.deepEqual(plan.cc, ['cc@example.com']);
    assert.equal(plan.changedToEmails, true);
    assert.equal(plan.changedCc, true);
  });

  it('falls back to to_email when headers lack to', () => {
    const plan = planRecipientBackfill({
      toEmail: 'lead@example.com',
      toEmails: null,
      cc: null,
      headers: {},
    });
    assert.deepEqual(plan.toEmails, ['lead@example.com']);
    assert.equal(plan.cc, null);
    assert.equal(plan.changedToEmails, true);
    assert.equal(plan.changedCc, false);
  });

  it('does not overwrite existing columns', () => {
    const plan = planRecipientBackfill({
      toEmail: 'primary@example.com',
      toEmails: ['already@example.com'],
      cc: ['kept@example.com'],
      headers: {
        to: 'new@example.com',
        cc: 'ignored@example.com',
      },
    });
    assert.deepEqual(plan.toEmails, ['already@example.com']);
    assert.deepEqual(plan.cc, ['kept@example.com']);
    assert.equal(plan.changedToEmails, false);
    assert.equal(plan.changedCc, false);
  });
});
