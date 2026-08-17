import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HELP_CONTACTS,
  HELP_EMAIL,
  HELP_SCHEDULE_URL,
  buildHelpMailto,
  helpTopicLabel,
  resolveHelpAccountManager,
  resolveHelpRecipient,
} from './helpRouting';

test('resolveHelpAccountManager defaults null and unknown values to Porter', () => {
  assert.equal(resolveHelpAccountManager(null), 'porter');
  assert.equal(resolveHelpAccountManager(undefined), 'porter');
  assert.equal(resolveHelpAccountManager('porter'), 'porter');
  assert.equal(resolveHelpAccountManager('kyle'), 'kyle');
  assert.equal(resolveHelpAccountManager('other'), 'porter');
});

test('resolveHelpRecipient always sends technical support to Porter', () => {
  assert.equal(resolveHelpRecipient('technical', 'kyle').id, 'porter');
  assert.equal(resolveHelpRecipient('technical', null).email, HELP_EMAIL);
});

test('resolveHelpRecipient routes strategy to the account manager', () => {
  assert.equal(resolveHelpRecipient('strategy', null).id, 'porter');
  assert.equal(resolveHelpRecipient('strategy', 'kyle').id, 'kyle');
  assert.equal(resolveHelpRecipient('strategy', 'kyle').email, HELP_CONTACTS.kyle.email);
  assert.equal(resolveHelpRecipient('strategy', 'kyle').scheduleUrl, HELP_CONTACTS.kyle.scheduleUrl);
});

test('buildHelpMailto encodes topic, account, and notes', () => {
  const mailto = buildHelpMailto({
    recipientEmail: HELP_CONTACTS.kyle.email,
    topic: 'strategy',
    notes: 'Need a check-in on Q3 campaigns',
    accountName: 'Acme',
    userName: 'Pat',
    userEmail: 'pat@acme.com',
  });

  assert.equal(mailto.subject, 'Furnace help — Strategy/check-in — Acme');
  assert.match(mailto.body, /Topic: Strategy\/check-in/);
  assert.match(mailto.body, /Account: Acme/);
  assert.match(mailto.body, /From: Pat <pat@acme.com>/);
  assert.match(mailto.body, /Need a check-in on Q3 campaigns/);
  assert.equal(mailto.url.startsWith(`mailto:${HELP_CONTACTS.kyle.email}?`), true);
  assert.match(mailto.url, /subject=/);
  assert.match(mailto.url, /body=/);
});

test('Porter schedule URL stays the public booking link', () => {
  assert.equal(HELP_SCHEDULE_URL, HELP_CONTACTS.porter.scheduleUrl);
  assert.equal(helpTopicLabel('technical'), 'Technical support');
});
