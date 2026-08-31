import assert from 'node:assert/strict';
import test from 'node:test';
import { companyIdFromDomainOrNameStreet, isParkedOrSharedHost, registrableDomain } from './domain.js';

test('registrable domain uses PSL not last-two-labels', () => {
  assert.equal(registrableDomain('https://www.acme.co.uk/about?x=1'), 'acme.co.uk');
  assert.equal(registrableDomain('https://shop.example.com/path'), 'example.com');
  assert.equal(registrableDomain('acmeindustrial.test'), 'acmeindustrial.test');
});

test('parked and shared hosts are not identity', () => {
  assert.equal(isParkedOrSharedHost('coolco.wixsite.com'), true);
  assert.equal(isParkedOrSharedHost('wixsite.com'), true);
  assert.equal(isParkedOrSharedHost('acmeindustrial.test'), false);
  const id = companyIdFromDomainOrNameStreet({
    domain: 'coolco.wixsite.com',
    name: 'Cool Co',
    street: '1 Main',
  });
  assert.match(id, /^ns:/);
});
