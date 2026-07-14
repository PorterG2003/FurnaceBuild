import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  classifyMetaAdResults,
  parseMetaAdLibraryBodyText,
  pickMatchedAdsForSignals,
} from './metaAdLibraryParse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures', 'meta-ad-library');

test('parseMetaAdLibraryBodyText extracts Nike ads from live-shaped body text', () => {
  const body = readFileSync(join(fixturesDir, 'nike-body-sample.txt'), 'utf8');
  const snapshot = parseMetaAdLibraryBodyText(body, 'nike.com');
  assert.ok(snapshot.cards.length >= 2);
  const nikeCard = snapshot.cards.find(
    (card) =>
      card.page_name === 'Nike' &&
      (card.landing_url?.includes('nike.com') || card.link_urls.some((u) => u.includes('nike.com'))),
  );
  assert.ok(nikeCard, 'expected Nike card with nike.com destination');
  assert.match(nikeCard.primary_text ?? '', /Get the gear/i);
  assert.equal(nikeCard.headline, 'Nike Air Monarch IV');
  assert.equal(nikeCard.cta, 'Shop Now');
  const out = classifyMetaAdResults({
    searchDomain: 'nike.com',
    companyName: 'Nike',
    snapshot,
  });
  assert.equal(out.result, 'yes');
  const matchedAds = pickMatchedAdsForSignals(snapshot, 'nike.com', out, 'Nike');
  assert.ok(matchedAds.length >= 1);
  assert.ok(matchedAds.some((ad) => ad.landing_url?.includes('nike.com')));
});

test('parseMetaAdLibraryBodyText classifies Xtalks webinar ads as yes', () => {
  const body = readFileSync(join(fixturesDir, 'xtalks-body-sample.txt'), 'utf8');
  const snapshot = parseMetaAdLibraryBodyText(body, 'xtalks.com');
  const out = classifyMetaAdResults({
    searchDomain: 'xtalks.com',
    companyName: 'Xtalks',
    snapshot,
  });
  assert.equal(out.result, 'yes');
  assert.equal(out.matched_card?.page_name, 'Xtalks Webinars');
  const matchedAds = pickMatchedAdsForSignals(snapshot, 'xtalks.com', out, 'Xtalks');
  assert.equal(matchedAds.length, 2);
  assert.equal(matchedAds[0].cta, 'Sign Up');
  assert.ok(matchedAds.every((ad) => ad.landing_url?.includes('xtalks.com')));
});
