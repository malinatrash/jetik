import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GraphLayouter } from '../src/git/graph/layout';

test('linear history stays in one lane with one color', () => {
  const layout = new GraphLayouter();
  const rows = [layout.next('c', ['b']), layout.next('b', ['a']), layout.next('a', [])];
  assert.deepEqual(rows.map((row) => row.column), [0, 0, 0]);
  assert.deepEqual(new Set(rows.map((row) => row.color)).size, 1);
  assert.deepEqual(rows[0].top, []);
  assert.deepEqual(rows[1].top, [{ from: 0, to: 0, color: 0 }]);
  assert.deepEqual(rows[2].bottom, []);
});

test('merge commit forks a second lane that converges on the common ancestor', () => {
  const layout = new GraphLayouter();
  const merge = layout.next('m', ['a', 'b']);
  assert.deepEqual(merge.bottom, [
    { from: 0, to: 0, color: 0 },
    { from: 0, to: 1, color: 1 },
  ]);
  const a = layout.next('a', ['root']);
  assert.equal(a.column, 0);
  assert.equal(a.width, 2);
  const b = layout.next('b', ['root']);
  assert.equal(b.column, 1);
  // b's parent already has a lane: the edge bends into it and lane 1 is released.
  assert.deepEqual(b.bottom.at(-1), { from: 1, to: 0, color: 1 });
  const root = layout.next('root', []);
  assert.equal(root.column, 0);
  assert.equal(root.width, 1);
});

test('ongoing lane keeps its column and color when a later branch tip is listed first', () => {
  const layout = new GraphLayouter();
  const main2 = layout.next('main2', ['main1']);
  // The tip forks from `base`, but is newer than main1, so it reserves a lane for base first.
  const tip = layout.next('tip', ['base']);
  assert.equal(tip.column, 1);
  const main1 = layout.next('main1', ['base']);
  assert.equal(main1.column, 0);
  assert.deepEqual(main1.bottom, [
    { from: 1, to: 1, color: tip.color },
    { from: 0, to: 0, color: main2.color },
  ]);
  const base = layout.next('base', ['root']);
  assert.equal(base.column, 0);
  assert.equal(base.color, main2.color);
  // The tip's lane bends into main on the fork point's row and is released.
  assert.deepEqual(base.top, [
    { from: 0, to: 0, color: main2.color },
    { from: 1, to: 0, color: tip.color },
  ]);
  assert.equal(layout.next('root', []).width, 1);
});

test('new branch tip in a freed left lane bends into the lane its parent already has', () => {
  const layout = new GraphLayouter();
  layout.next('a2', ['a1']);
  const b2 = layout.next('b2', ['b1']);
  layout.next('a1', []);
  const tip = layout.next('tip', ['b1']);
  assert.equal(tip.column, 0);
  assert.deepEqual(tip.bottom.at(-1), { from: 0, to: 1, color: tip.color });
  const b1 = layout.next('b1', []);
  assert.equal(b1.column, 1);
  assert.equal(b1.color, b2.color);
});

test('unrelated branch head opens a new lane and reuses freed ones', () => {
  const layout = new GraphLayouter();
  layout.next('x2', ['x1']);
  const y = layout.next('y2', ['y1']);
  assert.equal(y.column, 1);
  layout.next('x1', []);
  const z = layout.next('z', []);
  assert.equal(z.column, 0);
});
