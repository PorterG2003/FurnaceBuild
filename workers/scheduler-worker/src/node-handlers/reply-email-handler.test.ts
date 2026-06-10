import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReplySubject } from './reply-email-handler.js';

test('buildReplySubject prefixes a plain thread subject', () => {
  assert.equal(buildReplySubject('Quick check-in'), 'Re: Quick check-in');
});

test('buildReplySubject never stacks reply/forward prefixes', () => {
  assert.equal(buildReplySubject('Re: Quick check-in'), 'Re: Quick check-in');
  assert.equal(buildReplySubject('RE: re: Quick check-in'), 'Re: Quick check-in');
  assert.equal(buildReplySubject('Fwd: Quick check-in'), 'Re: Quick check-in');
  assert.equal(buildReplySubject('FW: Re: Quick check-in'), 'Re: Quick check-in');
  assert.equal(buildReplySubject('AW: Quick check-in'), 'Re: Quick check-in');
});

test('buildReplySubject handles missing or empty subjects', () => {
  assert.equal(buildReplySubject(null), 'Re:');
  assert.equal(buildReplySubject(''), 'Re:');
  assert.equal(buildReplySubject('Re: '), 'Re:');
});

test('buildReplySubject only strips prefixes at the start of the subject', () => {
  assert.equal(buildReplySubject('Care: package update'), 'Re: Care: package update');
});
