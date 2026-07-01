import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clipCreativePreviewBox,
  isAcceptableCreativePreviewCandidate,
  layoutClipCenterPanel,
  layoutClipFromMetadataAnchor,
  layoutClipBelowMetadataAnchor,
  pickBestCreativePreviewCandidate,
  selectCreativeHrefsForSampling,
  type CreativePreviewCandidate,
} from './transparencyLookup.js';

const VIEWPORT = { width: 1440, height: 960 };

function candidate(overrides: Partial<CreativePreviewCandidate> = {}): CreativePreviewCandidate {
  return {
    x: 120,
    y: 180,
    width: 360,
    height: 140,
    textLength: 80,
    imageCount: 1,
    hasVideo: false,
    hasIframe: false,
    priority: 0,
    ...overrides,
  };
}

test('clipCreativePreviewBox adds padding and clamps to the viewport', () => {
  assert.deepEqual(
    clipCreativePreviewBox({ x: 8, y: 6, width: 200, height: 80 }, VIEWPORT),
    { x: 0, y: 0, width: 224, height: 98 },
  );
});

test('clipCreativePreviewBox offsets clips for a scrolled viewport', () => {
  assert.deepEqual(
    clipCreativePreviewBox({ x: 40, y: 50, width: 200, height: 80 }, VIEWPORT, { x: 0, y: 1200 }),
    { x: 24, y: 1238, width: 232, height: 104 },
  );
});

test('isAcceptableCreativePreviewCandidate rejects broad page-sized crops', () => {
  assert.equal(
    isAcceptableCreativePreviewCandidate(
      candidate({
        x: 20,
        y: 20,
        width: 1320,
        height: 760,
        textLength: 240,
        imageCount: 2,
      }),
      VIEWPORT,
    ),
    false,
  );
});

test('isAcceptableCreativePreviewCandidate rejects tiny low-signal nodes', () => {
  assert.equal(
    isAcceptableCreativePreviewCandidate(
      candidate({
        width: 90,
        height: 30,
        textLength: 8,
        imageCount: 0,
      }),
      VIEWPORT,
    ),
    false,
  );
});

test('isAcceptableCreativePreviewCandidate rejects textless iframe-backed creatives in strict mode', () => {
  assert.equal(
    isAcceptableCreativePreviewCandidate(
      candidate({
        width: 380,
        height: 187,
        textLength: 0,
        imageCount: 1,
        hasIframe: true,
      }),
      VIEWPORT,
      'strict',
    ),
    false,
  );
});

test('isAcceptableCreativePreviewCandidate accepts sized textless iframe creatives in relaxed mode', () => {
  assert.equal(
    isAcceptableCreativePreviewCandidate(
      candidate({
        width: 380,
        height: 187,
        textLength: 0,
        imageCount: 1,
        hasIframe: true,
      }),
      VIEWPORT,
      'relaxed',
    ),
    true,
  );
});

test('isAcceptableCreativePreviewCandidate still rejects tiny textless iframe creatives in relaxed mode', () => {
  assert.equal(
    isAcceptableCreativePreviewCandidate(
      candidate({
        width: 90,
        height: 30,
        textLength: 0,
        imageCount: 1,
        hasIframe: true,
      }),
      VIEWPORT,
      'relaxed',
    ),
    false,
  );
});

test('isAcceptableCreativePreviewCandidate rejects flat video scrubber-like media crops', () => {
  assert.equal(
    isAcceptableCreativePreviewCandidate(
      candidate({
        width: 420,
        height: 54,
        textLength: 0,
        imageCount: 1,
      }),
      VIEWPORT,
    ),
    false,
  );
});

test('isAcceptableCreativePreviewCandidate rejects candidates that contain video', () => {
  assert.equal(
    isAcceptableCreativePreviewCandidate(
      candidate({
        width: 480,
        height: 240,
        textLength: 60,
        imageCount: 1,
        hasVideo: true,
      }),
      VIEWPORT,
    ),
    false,
  );
});

test('isAcceptableCreativePreviewCandidate accepts tall narrow creatives when area is still bounded', () => {
  assert.equal(
    isAcceptableCreativePreviewCandidate(
      candidate({
        x: 530,
        y: 543,
        width: 380,
        height: 820,
        textLength: 0,
        imageCount: 1,
      }),
      VIEWPORT,
    ),
    true,
  );
});

test('isAcceptableCreativePreviewCandidate still rejects overly tall broad crops', () => {
  assert.equal(
    isAcceptableCreativePreviewCandidate(
      candidate({
        x: 400,
        y: 120,
        width: 760,
        height: 900,
        textLength: 120,
        imageCount: 2,
      }),
      VIEWPORT,
    ),
    false,
  );
});

test('pickBestCreativePreviewCandidate prefers the tighter acceptable ad card', () => {
  const best = pickBestCreativePreviewCandidate(
    [
      candidate({ width: 720, height: 320, priority: 0, textLength: 140, imageCount: 1 }),
      candidate({ width: 340, height: 110, priority: 2, textLength: 92, imageCount: 1 }),
    ],
    VIEWPORT,
  );

  assert.ok(best);
  assert.equal(best.width, 340);
  assert.equal(best.height, 110);
  assert.deepEqual(best.clip, {
    x: 104,
    y: 168,
    width: 372,
    height: 134,
  });
});

test('pickBestCreativePreviewCandidate returns null when only bad candidates exist', () => {
  const best = pickBestCreativePreviewCandidate(
    [
      candidate({ width: 1400, height: 820, textLength: 300, imageCount: 4 }),
      candidate({ width: 80, height: 20, textLength: 5, imageCount: 0 }),
    ],
    VIEWPORT,
  );

  assert.equal(best, null);
});

test('pickBestCreativePreviewCandidate prefers strict acceptable candidate over relaxed-only iframe', () => {
  const textlessIframe = candidate({
    width: 380,
    height: 187,
    textLength: 0,
    imageCount: 1,
    hasIframe: true,
    priority: 0,
  });
  const textCreative = candidate({
    width: 340,
    height: 110,
    textLength: 92,
    imageCount: 1,
    priority: 2,
  });

  assert.equal(pickBestCreativePreviewCandidate([textlessIframe, textCreative], VIEWPORT, 'strict')?.width, 340);
  assert.equal(pickBestCreativePreviewCandidate([textlessIframe], VIEWPORT, 'strict'), null);
  assert.equal(pickBestCreativePreviewCandidate([textlessIframe], VIEWPORT, 'relaxed')?.width, 380);
});

test('layoutClipFromMetadataAnchor builds a bounded crop above metadata labels', () => {
  const clip = layoutClipFromMetadataAnchor(720, VIEWPORT);
  assert.ok(clip);
  assert.ok(clip!.width >= 120);
  assert.ok(clip!.height >= 48);
  assert.ok(clip!.y + clip!.height <= 720);
});

test('layoutClipCenterPanel stays within the default viewport', () => {
  const clip = layoutClipCenterPanel(VIEWPORT);
  assert.ok(clip.x >= 0);
  assert.ok(clip.y >= 0);
  assert.ok(clip.x + clip.width <= VIEWPORT.width);
  assert.ok(clip.y + clip.height <= VIEWPORT.height);
  assert.ok(clip.width * clip.height >= 8_000);
  assert.ok(clip.y >= Math.floor(VIEWPORT.height * 0.35), 'center panel starts below the header area');
});

test('layoutClipBelowMetadataAnchor clips below the metadata anchor', () => {
  const clip = layoutClipBelowMetadataAnchor(340, 20, VIEWPORT);
  assert.ok(clip);
  assert.ok(clip!.y > 340, 'clip starts below the anchor');
  assert.ok(clip!.height >= 48);
  assert.ok(clip!.y + clip!.height <= VIEWPORT.height);
  assert.ok(clip!.width * clip!.height >= 8_000);
});

test('layoutClipBelowMetadataAnchor returns null when anchor is near bottom', () => {
  const clip = layoutClipBelowMetadataAnchor(900, 20, VIEWPORT);
  assert.equal(clip, null);
});

test('selectCreativeHrefsForSampling keeps one advertiser cluster per domain', () => {
  const selected = selectCreativeHrefsForSampling([
    '/advertiser/AR11111111111111111111/creative/CR1?region=US',
    '/advertiser/AR22222222222222222222/creative/CR2?region=US',
    '/advertiser/AR11111111111111111111/creative/CR3?region=US',
    '/advertiser/AR11111111111111111111/creative/CR4?region=US',
  ]);

  assert.equal(selected.selectedAdvertiserId, 'AR11111111111111111111');
  assert.deepEqual(selected.selectedHrefs, [
    '/advertiser/AR11111111111111111111/creative/CR1?region=US',
    '/advertiser/AR11111111111111111111/creative/CR3?region=US',
    '/advertiser/AR11111111111111111111/creative/CR4?region=US',
  ]);
  assert.deepEqual(selected.advertiserCreativeCounts, {
    AR11111111111111111111: 3,
    AR22222222222222222222: 1,
  });
});

test('selectCreativeHrefsForSampling falls back to all hrefs when advertiser ids are missing', () => {
  const hrefs = ['/creative/CR1?region=US', '/creative/CR2?region=US'];
  const selected = selectCreativeHrefsForSampling(hrefs);

  assert.equal(selected.selectedAdvertiserId, null);
  assert.deepEqual(selected.selectedHrefs, hrefs);
  assert.deepEqual(selected.advertiserCreativeCounts, {});
});

test('selectCreativeHrefsForSampling keeps the largest advertiser cluster for prod-like anytime results', () => {
  const selected = selectCreativeHrefsForSampling([
    '/advertiser/AR08607200154371489793/creative/CR09252723482578386945?region=US',
    '/advertiser/AR04171424726394077185/creative/CR09070879540837875713?region=US',
    '/advertiser/AR08607200154371489793/creative/CR05046974159238725633?region=US',
  ]);

  assert.equal(selected.selectedAdvertiserId, 'AR08607200154371489793');
  assert.deepEqual(selected.selectedHrefs, [
    '/advertiser/AR08607200154371489793/creative/CR09252723482578386945?region=US',
    '/advertiser/AR08607200154371489793/creative/CR05046974159238725633?region=US',
  ]);
  assert.deepEqual(selected.advertiserCreativeCounts, {
    AR08607200154371489793: 2,
    AR04171424726394077185: 1,
  });
});
