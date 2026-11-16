import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dropTodo, renderTodo, shellQuote, squashTodo } from '../src/git/rebase/todo';

test('squash moves later selected commits right after the oldest one', () => {
  const todo = renderTodo(squashTodo(['a', 'b', 'c', 'd'], new Set(['a', 'c']), "/tmp/it's/msg"));
  assert.equal(
    todo,
    [
      'pick a',
      'fixup c',
      `exec git commit --amend --only --allow-empty -F '/tmp/it'\\''s/msg'`,
      'pick b',
      'pick d',
      '',
    ].join('\n'),
  );
});

test('dropping every commit leaves a noop', () => {
  assert.equal(renderTodo(dropTodo(['a'], new Set(['a']))), 'noop\n');
});

test('shellQuote normalizes Windows separators', () => {
  assert.equal(shellQuote('C:\\Temp\\todo'), `'C:/Temp/todo'`);
});
