import test from 'node:test';
import assert from 'node:assert/strict';
import { backdropClose } from './backdropClose.ts';

type Ev = Parameters<ReturnType<typeof backdropClose>['onClick']>[0];

const backdrop = {};
const modal = {};
const ev = (target: object): Ev =>
  ({ target, currentTarget: backdrop }) as unknown as Ev;

test('closes when press and release are both on the backdrop', () => {
  let closed = 0;
  const p = backdropClose(() => void (closed += 1));
  p.onMouseDown(ev(backdrop));
  p.onClick(ev(backdrop));
  assert.equal(closed, 1);
});

test('does not close when the press began inside the modal (text-selection drag)', () => {
  let closed = 0;
  const p = backdropClose(() => void (closed += 1));
  p.onMouseDown(ev(modal));
  p.onClick(ev(backdrop));
  assert.equal(closed, 0);
  // the next genuine backdrop click works again
  p.onMouseDown(ev(backdrop));
  p.onClick(ev(backdrop));
  assert.equal(closed, 1);
});

test('does not close on clicks that originate inside the modal', () => {
  let closed = 0;
  const p = backdropClose(() => void (closed += 1));
  p.onMouseDown(ev(modal));
  p.onClick(ev(modal));
  assert.equal(closed, 0);
});

test('a click with no preceding press (keyboard) still closes', () => {
  let closed = 0;
  const p = backdropClose(() => void (closed += 1));
  p.onClick(ev(backdrop));
  assert.equal(closed, 1);
});
