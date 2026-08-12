import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractLandingPeople, looksLikePersonName } from './landingPeople.js';

describe('extractLandingPeople', () => {
  it('finds hosted-by / speaker labels', () => {
    const people = extractLandingPeople(
      'Join our free webinar hosted by Sarah Chezbro. About the host: Sarah Chezbro helps associations.',
      { companyName: 'Texas Apartment Association' },
    );
    assert.ok(people.some((p) => p.person_name === 'Sarah Chezbro'));
  });

  it('finds Meet Name patterns', () => {
    const people = extractLandingPeople('Meet Dr. Mike Smith for real answers to your health issues.');
    assert.ok(people.some((p) => /Mike Smith/i.test(p.person_name)));
  });

  it('parses json-ld Person name', () => {
    const people = extractLandingPeople(
      '{"@type":"Person","name":"Natalia Cimpean","jobTitle":"Director"}',
    );
    assert.ok(people.some((p) => p.person_name === 'Natalia Cimpean'));
  });

  it('rejects junk and company-like names', () => {
    assert.equal(looksLikePersonName('Register Now'), false);
    assert.equal(looksLikePersonName('Acme Services LLC'), false);
    assert.equal(looksLikePersonName('Jane'), false);
    assert.equal(looksLikePersonName('Jane Doe'), true);
  });
});
