import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorPanelBelow } from './popoverPosition.ts';

const MAX = 384; // 24rem

test('on a phone the panel never leaves the screen, wherever the button is', () => {
  const vw = 375;
  for (let right = 40; right <= vw; right += 5) {
    const p = anchorPanelBelow({ right, bottom: 50 }, vw, MAX);
    assert.ok(p.left >= 12, `left ${p.left} at button right=${right}`);
    assert.ok(p.left + p.width <= vw - 12, `right edge ${p.left + p.width} at button right=${right}`);
    assert.equal(p.width, vw - 24, 'fills the width minus the gutters');
  }
});

test('the case that used to overflow: a button 85px from the right edge of a 375px screen', () => {
  // old CSS: right 85px, width 351px -> left edge at -61px
  const p = anchorPanelBelow({ right: 290, bottom: 52 }, 375, MAX);
  assert.deepEqual(p, { top: 60, left: 12, width: 351 });
});

test('on a wide screen the panel keeps its width and lines up with the button', () => {
  const p = anchorPanelBelow({ right: 1000, bottom: 52 }, 1440, MAX);
  assert.deepEqual(p, { top: 60, left: 616, width: 384 });
});

test('a button near the left edge keeps the panel inside the gutter', () => {
  const p = anchorPanelBelow({ right: 100, bottom: 52 }, 1440, MAX);
  assert.equal(p.left, 12);
  assert.equal(p.width, 384);
});

test('a button at the far right keeps the panel inside the right gutter', () => {
  const p = anchorPanelBelow({ right: 1440, bottom: 52 }, 1440, MAX);
  assert.equal(p.left + p.width, 1440 - 12);
});

test('a tiny viewport still never produces a negative width or position', () => {
  const p = anchorPanelBelow({ right: 10, bottom: 0 }, 20, MAX);
  assert.equal(p.width, 0);
  assert.ok(p.left >= 0 && p.left <= 20, `left ${p.left}`);
  assert.equal(p.top, 8);
});
