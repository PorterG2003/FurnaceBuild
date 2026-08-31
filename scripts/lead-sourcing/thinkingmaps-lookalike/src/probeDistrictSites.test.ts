import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { homepageLooksLikeDistrict } from './probeDistrictSites.js';

describe('homepageLooksLikeDistrict', () => {
  it('promotes a known CMS homepage', () => {
    const look = homepageLooksLikeDistrict({
      html: '<link href="https://resources.finalsite.net/css/x.css"><title>Home</title>',
      url: 'https://www.aps.edu/',
      leaName: 'ALBUQUERQUE',
      state: 'NM',
    });
    assert.equal(look.promote, true);
    assert.match(look.reason, /cms:finalsite/);
  });

  it('promotes when the page title shares a distinctive district token', () => {
    const look = homepageLooksLikeDistrict({
      html: '<title>Albuquerque Public Schools</title><h1>Welcome</h1>',
      url: 'https://www.aps.edu/',
      leaName: 'ALBUQUERQUE',
      state: 'NM',
    });
    assert.equal(look.promote, true);
    assert.match(look.reason, /title_token:albuquerque/);
  });

  it('does not promote a ranking page with no district tokens', () => {
    const look = homepageLooksLikeDistrict({
      html: '<title>School Rankings 2025</title><h1>Compare districts</h1>',
      url: 'https://edopportunity.org/reports/az',
      leaName: 'ALBUQUERQUE',
      state: 'NM',
    });
    assert.equal(look.promote, false);
  });
});
