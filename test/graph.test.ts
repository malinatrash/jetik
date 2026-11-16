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

test('unrelated branch head opens a new lane and reuses freed ones', () => {
  const layout = new GraphLayouter();
  layout.next('x2', ['x1']);
  const y = layout.next('y2', ['y1']);
  assert.equal(y.column, 1);
  layout.next('x1', []);
  const z = layout.next('z', []);
  assert.equal(z.column, 0);
});
