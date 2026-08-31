import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFixturePageClient } from '../directoryBrowser.js';
import { fixturesDir } from '../lib/env.js';
import {
  followupDirectoryUrls,
  harvestApptegy,
  organizationsFromHtml,
  parseClientWorkState,
  peopleFromNuxtData,
  peopleFromStaffJson,
  schoolSlugsFromHtml,
} from './apptegy.js';
import { harvestEdlio, parseEdlioStaff } from './edlio.js';
import { directoryElementId, emailFromProfileHtml, harvestFinalsite, parseFinalsiteDirectory, parseFinalsitePageCount } from './finalsite.js';
import { schoolSiteUrls } from './generic.js';

describe('finalsite adapter', () => {
  it('parses name, title, school, and reversed-string email', () => {
    const html = readFileSync(join(fixturesDir, 'pages/palmdale-finalsite.html'), 'utf8');
    const people = parseFinalsiteDirectory(html, 'https://www.palmdalesd.org/directory');
    assert.equal(people.length, 4);
    const elena = people.find((row) => row.email === 'elena.brooks@palmdalesd.org');
    assert.equal(elena?.title, 'Assistant Principal');
    assert.equal(elena?.evidence, 'location_field');
    assert.ok(elena?.school_hint.toLowerCase().includes('tumbleweed'));
    const rendered = `
      <div class="fsConstituentItem">
        <h3 class="fsFullName"><a>Elena Brooks</a></h3>
        <div class="fsTitles">Assistant Principal</div>
        <div class="fsLocations">Tumbleweed Elementary</div>
        <div class="fsEmail"><a href="mailto:elena.brooks@palmdalesd.org">email</a></div>
      </div>`;
    const live = parseFinalsiteDirectory(rendered, 'https://www.palmdalesd.org/directory');
    assert.equal(live[0]?.email, 'elena.brooks@palmdalesd.org');
    assert.deepEqual(parseFinalsitePageCount(html), { shown: 3, total: 3 });
    const listing = readFileSync(join(fixturesDir, 'pages/adams-listing.html'), 'utf8');
    const noEmail = parseFinalsiteDirectory(listing, 'https://www.adams12.org/directory');
    assert.equal(noEmail[0]?.first_name, 'Charles');
    assert.equal(noEmail[0]?.school_hint, 'Thornton High School');
    assert.equal(noEmail[0]?.email, '');
    assert.equal(noEmail[0]?.external_id, '6012');
    assert.equal(directoryElementId(listing), '59');
    const profile = readFileSync(join(fixturesDir, 'pages/adams-profile-6012.html'), 'utf8');
    assert.equal(emailFromProfileHtml(profile), 'charles.arellano@adams12.org');
    const departments = `
      <div class="fsConstituentItem" data-constituent-id="8641">
        <h3 class="fsFullName"><a>Bonita Adams</a></h3>
        <div class="fsTitles">Ast Principal-Elementary</div>
        <div class="fsDepartments">Suder Es</div>
      </div>`;
    const fromDept = parseFinalsiteDirectory(departments, 'https://www.clayton.k12.ga.us/directory');
    assert.equal(fromDept[0]?.title, 'Ast Principal-Elementary');
    assert.equal(fromDept[0]?.school_hint, 'Suder Es');
    const inferred = parseFinalsiteDirectory(
      `<div class="fsConstituentItem" data-constituent-id="2887">
        <h3 class="fsFullName"><a>Tiffany Babb</a></h3>
        <div class="fsLocations">CRS</div>
        <div class="fsEmail"><a href="mailto:tbabb@ardsleyschools.org">email</a></div>
      </div>`,
      'https://www.ardsleyschools.org/directory?const_search_keyword=principal',
    );
    assert.equal(inferred[0]?.title, 'Principal');
    assert.equal(inferred[0]?.school_hint, 'CRS');
  });

  it('fills listing emails from a profile mailto fragment', async () => {
    const result = await harvestFinalsite({
      client: createFixturePageClient(),
      website: 'https://www.adams12.org/',
      origin: 'https://www.adams12.org',
      schools: [],
      maxPages: 20,
      platform: 'finalsite',
    });
    const charles = result.people.find((row) => row.last_name === 'Arellano');
    assert.equal(charles?.email, 'charles.arellano@adams12.org');
    assert.ok(charles?.school_hint.toLowerCase().includes('thornton'));
    assert.ok(result.notes.some((note) => note.startsWith('profiles:')));
  });
});

describe('apptegy adapter', () => {
  it('walks staff JSON and extracts school slugs from the homepage', () => {
    const people = peopleFromStaffJson(
      {
        staff: [
          {
            first_name: 'Elena',
            last_name: 'Brooks',
            title: 'Assistant Principal',
            email: 'elena.brooks@tumbleweedschools.org',
            department: 'Tumbleweed Elementary',
            location: 'Tumbleweed Elementary',
          },
        ],
      },
      'https://www.tumbleweedschools.org/o/tumbleweed/staff.json',
      'tumbleweed',
    );
    assert.equal(people[0]?.email, 'elena.brooks@tumbleweedschools.org');
    assert.equal(people[0]?.evidence, 'school_url');
    const admin = peopleFromStaffJson(
      {
        staff: [
          {
            first: 'Matt',
            last: 'Sheffield',
            title: 'Principal',
            email: 'matt.sheffield@hesperiausd.org',
            department: 'Administration',
          },
        ],
      },
      'https://www.hesperiausd.org/o/krystal/staff.json',
      'Krystal School of Science Math & Technology',
    );
    assert.equal(admin[0]?.school_hint, 'Krystal School of Science Math & Technology');
    const html = readFileSync(join(fixturesDir, 'homepages/apptegy.html'), 'utf8');
    assert.deepEqual(schoolSlugsFromHtml(html, 'https://www.tumbleweedschools.org/'), ['tumbleweed']);
    const withOrgs = `${html}<script>window.clientWorkStateTemp = JSON.parse("{\\"organizations\\":[{\\"name\\":\\"Ridge Elementary\\",\\"path_prefix\\":\\"/o/ridge\\"}]}")</script>`;
    assert.ok(schoolSlugsFromHtml(withOrgs, 'https://www.tumbleweedschools.org/').includes('ridge'));
    const nuxt = [
      ['ShallowReactive', 1],
      { staff: 2 },
      [3],
      { id: 4, email: 5, first: 6, last: 7, title: 8, full_name: 9 },
      99,
      'elena.brooks@tumbleweedschools.org',
      'Elena',
      'Brooks',
      'Assistant Principal',
      'Elena Brooks',
    ];
    const fromNuxt = peopleFromNuxtData(nuxt, 'https://www.tumbleweedschools.org/o/tumbleweed/staff', 'tumbleweed');
    assert.equal(fromNuxt[0]?.email, 'elena.brooks@tumbleweedschools.org');
    assert.equal(fromNuxt[0]?.first_name, 'Elena');
    assert.equal(fromNuxt[0]?.title, 'Assistant Principal');
    assert.deepEqual(
      followupDirectoryUrls(
        JSON.stringify({
          directories: [],
          meta: {
            sections: [{ url: 'https://thrillshare-cmsv2.services.thrillshare.com/api/v4/o/42/cms/directories?slug=staff-ridge' }],
          },
        }),
        'https://thrillshare-cmsv2.services.thrillshare.com/api/v4/o/42/cms/directories',
      ),
      ['https://thrillshare-cmsv2.services.thrillshare.com/api/v4/o/42/cms/directories?slug=staff-ridge'],
    );
  });

  it('parses escaped clientWorkState organizations and fetches v4 directories', async () => {
    const payload = {
      organizations: [
        { id: 7, name: 'Pad School', path_prefix: '/o/pad', extra: 'x'.repeat(20_000) },
        { id: 42, name: 'Ridge Elementary', path_prefix: '/o/ridge' },
      ],
    };
    const html = `<script>window.clientWorkStateTemp = JSON.parse(${JSON.stringify(JSON.stringify(payload))})</script>`;
    const state = parseClientWorkState(html);
    assert.ok(state);
    const orgs = organizationsFromHtml(html);
    assert.equal(orgs.length, 2);
    assert.equal(orgs.find((row) => row.id === '42')?.name, 'Ridge Elementary');

    const result = await harvestApptegy({
      client: createFixturePageClient(),
      website: 'https://www.tumbleweedschools.org/orgs',
      origin: 'https://www.tumbleweedschools.org',
      schools: [],
      maxPages: 20,
      platform: 'apptegy',
    });
    const elena = result.people.find((row) => row.email === 'elena.brooks@tumbleweedschools.org');
    assert.equal(elena?.title, 'Principal');
    assert.equal(elena?.school_hint, 'Ridge Elementary');
    assert.ok(result.notes.some((note) => note === 'orgs:1' || note.startsWith('orgs:')));
  });
});

describe('edlio adapter', () => {
  it('parses staff cards and keeps displayed emails', async () => {
    const html = readFileSync(join(fixturesDir, 'pages/edlio-staff.html'), 'utf8');
    const people = parseEdlioStaff(html, 'https://www.bassettusd.org/apps/staff');
    const marco = people.find((row) => row.last_name === 'Leal');
    assert.equal(marco?.email, 'marco.leal@bassettusd.org');
    assert.equal(marco?.title, 'Principal');
    assert.equal(marco?.school_hint, 'Bassett High School');
    assert.equal(people.some((row) => /teacher/i.test(row.title)), false);
    const harvested = await harvestEdlio({
      client: createFixturePageClient(),
      website: 'https://www.bassettusd.org/',
      origin: 'https://www.bassettusd.org',
      schools: [],
      maxPages: 12,
      platform: 'edlio',
    });
    assert.equal(
      harvested.people.find((row) => row.email === 'marco.leal@bassettusd.org')?.school_hint,
      'Bassett High School',
    );
  });
});

describe('generic adapter', () => {
  it('enumerates school subdomains from a district homepage', () => {
    const html = `<a href="https://concord.ardsleyschools.org">Concord Road Elementary</a>`;
    const urls = schoolSiteUrls(html, 'https://www.ardsleyschools.org/');
    assert.ok(urls.some((url) => url.includes('concord.ardsleyschools.org')));
  });
});
