import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clipCreativePreviewBox,
  isAcceptableCreativePreviewCandidate,
  pickBestCreativePreviewCandidate,
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

test('isAcceptableCreativePreviewCandidate accepts textless iframe-sized creatives when media is present', () => {
  assert.equal(
    isAcceptableCreativePreviewCandidate(
      candidate({
        width: 380,
        height: 187,
        textLength: 0,
        imageCount: 1,
      }),
      VIEWPORT,
    ),
    true,
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
