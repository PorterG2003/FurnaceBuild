import test from 'node:test';
import assert from 'node:assert/strict';
import { mapProspeoToProfile, pickRevealedMobile } from './mapProspeoToProfile';
import type { ProspeoEnrichResponse } from './prospeoClient';

test('mapProspeoToProfile maps person + company + revealed mobile', () => {
  const response: ProspeoEnrichResponse = {
    error: false,
    person: {
      first_name: 'Jane',
      last_name: 'Doe',
      full_name: 'Jane Doe',
      linkedin_url: 'https://linkedin.com/in/janedoe',
      current_job_title: 'VP Sales',
      mobile: {
        status: 'VERIFIED',
        revealed: true,
        mobile: '+15551234567',
      },
    },
    company: {
      name: 'Acme Inc',
      website: 'https://acme.com',
      linkedin_url: 'https://linkedin.com/company/acme',
    },
  };

  const { suggestion, phoneNumbers } = mapProspeoToProfile(response);
  assert.equal(suggestion.name, 'Jane Doe');
  assert.equal(suggestion.first_name, 'Jane');
  assert.equal(suggestion.last_name, 'Doe');
  assert.equal(suggestion.title, 'VP Sales');
  assert.equal(suggestion.phone_number, null);
  assert.equal(suggestion.mobile_phone_number, '+15551234567');
  assert.equal(suggestion.linkedin_url, 'https://linkedin.com/in/janedoe');
  assert.equal(suggestion.company_name, 'Acme Inc');
  assert.equal(suggestion.website, 'https://acme.com');
  assert.equal(suggestion.company_linkedin_url, 'https://linkedin.com/company/acme');
  assert.deepEqual(phoneNumbers, [
    { sanitized_number: '+15551234567', raw_number: '+15551234567' },
  ]);
});

test('mapProspeoToProfile ignores unrevealed mobile', () => {
  const { suggestion, phoneNumbers } = mapProspeoToProfile({
    person: {
      first_name: 'Jane',
      mobile: {
        status: 'VERIFIED',
        revealed: false,
        mobile: '+1 415-3**-****',
      },
    },
    company: { domain: 'acme.com' },
  });
  assert.equal(suggestion.mobile_phone_number, null);
  assert.deepEqual(phoneNumbers, []);
  assert.equal(suggestion.website, 'https://acme.com');
});

test('mapProspeoToProfile returns nulls for missing data', () => {
  const { suggestion, phoneNumbers } = mapProspeoToProfile({
    person: { first_name: 'Solo' },
  });
  assert.equal(suggestion.name, 'Solo');
  assert.equal(suggestion.last_name, null);
  assert.equal(suggestion.mobile_phone_number, null);
  assert.equal(suggestion.company_name, null);
  assert.deepEqual(phoneNumbers, []);
});

test('pickRevealedMobile prefers mobile then international', () => {
  assert.equal(
    pickRevealedMobile({
      mobile: { revealed: true, mobile: '+15551112222' },
    }),
    '+15551112222',
  );
  assert.equal(
    pickRevealedMobile({
      mobile: { revealed: true, mobile_international: '+1 555 111 2222' },
    }),
    '+1 555 111 2222',
  );
  assert.equal(pickRevealedMobile({ mobile: { revealed: false, mobile: '+1' } }), null);
});
