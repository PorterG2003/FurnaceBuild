import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isLinkedInMemberIdUrl,
  parseHeadlineHints,
  parseReactorName,
} from './nameParse.js';

describe('parseReactorName', () => {
  it('strips Dr. and Ed.S. credentials', () => {
    const parsed = parseReactorName('Dr. Melissa DeFrenza-Israel, Ed.S., LCPC');
    assert.equal(parsed.firstName, 'Melissa');
    assert.equal(parsed.lastName, 'DeFrenza-Israel');
  });

  it('strips trailing CAA credential', () => {
    const parsed = parseReactorName('Eric Pritchard, CAA');
    assert.equal(parsed.firstName, 'Eric');
    assert.equal(parsed.lastName, 'Pritchard');
  });

  it('strips nickname and middle initial', () => {
    const parsed = parseReactorName('Dr. Melissa D. Patschke. (Missie)');
    assert.equal(parsed.firstName, 'Melissa');
    assert.equal(parsed.lastName, 'Patschke');
  });

  it('handles Ed.D. suffix', () => {
    const parsed = parseReactorName('Melissa Pearlman, Ed.D.');
    assert.equal(parsed.firstName, 'Melissa');
    assert.equal(parsed.lastName, 'Pearlman');
  });
});

describe('parseHeadlineHints', () => {
  it('extracts org after at', () => {
    const hints = parseHeadlineHints('Superintendent at Heard County Schools, Georgia');
    assert.equal(hints.title, 'Superintendent');
    assert.equal(hints.organizationName, 'Heard County Schools, Georgia');
  });

  it('extracts org after slash', () => {
    const hints = parseHeadlineHints('Principal / Muhlenberg School District');
    assert.equal(hints.title, 'Principal');
    assert.equal(hints.organizationName, 'Muhlenberg School District');
  });

  it('extracts org from comma-style school headline', () => {
    const hints = parseHeadlineHints('Assistant Superintendent, Pittsburgh Public Schools');
    assert.equal(hints.title, 'Assistant Superintendent');
    assert.equal(hints.organizationName, 'Pittsburgh Public Schools');
  });

  it('extracts org from Proud Principal comma line', () => {
    const hints = parseHeadlineHints('Proud Principal, Highlands Elementary School');
    assert.equal(hints.title, 'Proud Principal');
    assert.equal(hints.organizationName, 'Highlands Elementary School');
  });

  it('extracts org after dash separator', () => {
    const hints = parseHeadlineHints('Principal - Goshen High School');
    assert.equal(hints.title, 'Principal');
    assert.equal(hints.organizationName, 'Goshen High School');
  });

  it('extracts org after dash with district numbers', () => {
    const hints = parseHeadlineHints(
      'Assistant Superintendent - Lake Forest School Districts 67 & 115',
    );
    assert.equal(hints.title, 'Assistant Superintendent');
    assert.equal(hints.organizationName, 'Lake Forest School Districts 67 & 115');
  });

  it('extracts school after Dean of Students title phrase', () => {
    const hints = parseHeadlineHints('Dean of Students Rolling Meadows High School');
    assert.equal(hints.title.toLowerCase(), 'dean of students');
    assert.equal(hints.organizationName, 'Rolling Meadows High School');
  });

  it('extracts school from pipe-separated headline', () => {
    const hints = parseHeadlineHints(
      'Education Leader | Director Mount litera Zee School Kalaburagi | Alumni IIM Calcutta',
    );
    assert.match(hints.organizationName, /Mount litera Zee School/i);
    assert.ok(hints.organizationName.length > 5);
  });

  it('rejects marketing of-fragments', () => {
    const hints = parseHeadlineHints(
      '“Live to Inspire, Dare to Achieve.” School Administrator PEL, School Counselor PEL',
    );
    // Should not treat "Dare to Achieve…" as org via \bof\b
    assert.ok(
      !/^Dare to Achieve/i.test(hints.organizationName),
      `unexpected org: ${hints.organizationName}`,
    );
  });

  it('truncates org at Clifton strengths clause', () => {
    const hints = parseHeadlineHints(
      'Principal at Millard Public Schools. Clifton strengths are Context, Intellection',
    );
    assert.equal(hints.title, 'Principal');
    assert.match(hints.organizationName, /^Millard Public Schools/i);
    assert.ok(!/Clifton/i.test(hints.organizationName));
  });

  it('falls back to title-only when no org separator', () => {
    const hints = parseHeadlineHints('3-5 Principal');
    assert.equal(hints.title, '3-5 Principal');
    assert.equal(hints.organizationName, '');
  });
});

describe('isLinkedInMemberIdUrl', () => {
  it('detects ACo member ids', () => {
    assert.equal(
      isLinkedInMemberIdUrl('https://www.linkedin.com/in/ACoAAGASxXQBAnJoI2pBoc-PKeDwAOmE66g539c'),
      true,
    );
  });

  it('rejects vanity urls', () => {
    assert.equal(isLinkedInMemberIdUrl('https://www.linkedin.com/in/jane-doe-12345'), false);
  });
});
