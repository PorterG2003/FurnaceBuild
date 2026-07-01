import test from 'node:test';
import assert from 'node:assert/strict';
import { mapApolloToProfile, pickPhoneFromNumbers } from './mapApolloToProfile';
import type { ApolloPerson } from './apolloClient';

test('mapApolloToProfile maps person + organization fields', () => {
  const person: ApolloPerson = {
    first_name: 'Jane',
    last_name: 'Doe',
    title: 'VP Sales',
    email: 'jane@acme.com',
    linkedin_url: 'https://linkedin.com/in/janedoe',
    phone_numbers: [{ sanitized_number: '+15551234567', raw_number: '555-1234567' }],
    organization: {
      name: 'Acme Inc',
      website_url: 'https://acme.com',
      linkedin_url: 'https://linkedin.com/company/acme',
    },
  };

  const result = mapApolloToProfile(person);
  assert.equal(result.name, 'Jane Doe');
  assert.equal(result.first_name, 'Jane');
  assert.equal(result.last_name, 'Doe');
  assert.equal(result.title, 'VP Sales');
  assert.equal(result.phone_number, '+15551234567');
  assert.equal(result.mobile_phone_number, null);
  assert.equal(result.linkedin_url, 'https://linkedin.com/in/janedoe');
  assert.equal(result.company_name, 'Acme Inc');
  assert.equal(result.website, 'https://acme.com');
  assert.equal(result.company_linkedin_url, 'https://linkedin.com/company/acme');
});

test('mapApolloToProfile prefers explicit name and falls back to primary_domain', () => {
  const result = mapApolloToProfile({
    name: 'John Q. Public',
    first_name: 'John',
    last_name: 'Public',
    organization: { name: 'Beta LLC', primary_domain: 'beta.io' },
  });
  assert.equal(result.name, 'John Q. Public');
  assert.equal(result.website, 'https://beta.io');
});

test('mapApolloToProfile returns nulls for missing data', () => {
  const result = mapApolloToProfile({ first_name: 'Solo' });
  assert.equal(result.name, 'Solo');
  assert.equal(result.last_name, null);
  assert.equal(result.phone_number, null);
  assert.equal(result.mobile_phone_number, null);
  assert.equal(result.company_name, null);
  assert.equal(result.website, null);
  assert.equal(result.title, null);
});

test('pickPhoneFromNumbers prefers sanitized_number', () => {
  assert.equal(
    pickPhoneFromNumbers([{ raw_number: '555', sanitized_number: '+15551234567' }]),
    '+15551234567',
  );
});

test('mapApolloToProfile trims whitespace and treats blanks as null', () => {
  const result = mapApolloToProfile({
    first_name: '  ',
    title: '  Director  ',
    organization: { name: '   ' },
  });
  assert.equal(result.first_name, null);
  assert.equal(result.title, 'Director');
  assert.equal(result.company_name, null);
});
