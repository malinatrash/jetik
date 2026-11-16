import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommits, parseNameStatus, parseRefs } from '../src/git/parsers';
import { classifyRemoteFailure, pushArgs } from '../src/git/services/remoteService';
import { splitRemoteBranch } from '../src/git/services/refService';

const F = '\x1f';

test('parseCommits reads NUL-separated records', () => {
  const out = [`h1${F}p1 p2${F}Ann${F}a@x${F}100${F}Merge it`, `h2${F}${F}Bob${F}b@x${F}50${F}`].join('\0') + '\0';
  assert.deepEqual(parseCommits(out), [
    { hash: 'h1', parents: ['p1', 'p2'], author: 'Ann', email: 'a@x', date: 100000, subject: 'Merge it' },
    { hash: 'h2', parents: [], author: 'Bob', email: 'b@x', date: 50000, subject: '' },
  ]);
});

test('parseRefs classifies refs, peels tags and skips remote HEAD', () => {
  const out = [
    `refs/heads/main${F}aaa${F}${F}origin/main${F}[ahead 2, behind 1]${F}*`,
    `refs/heads/old${F}bbb${F}${F}origin/old${F}[gone]${F} `,
    `refs/remotes/origin/HEAD${F}aaa${F}${F}${F}${F} `,
    `refs/remotes/origin/feature/x${F}ccc${F}${F}${F}${F} `,
    `refs/tags/v1${F}tagobj${F}ddd${F}${F}${F} `,
  ].join('\n');
  const refs = parseRefs(out);
  assert.deepEqual(refs.map((ref) => [ref.kind, ref.name, ref.hash]), [
    ['local', 'main', 'aaa'],
    ['local', 'old', 'bbb'],
    ['remote', 'origin/feature/x', 'ccc'],
    ['tag', 'v1', 'ddd'],
  ]);
  assert.deepEqual(refs[0].upstream, { name: 'origin/main', ahead: 2, behind: 1, gone: false });
  assert.equal(refs[0].current, true);
  assert.equal(refs[1].upstream?.gone, true);
  assert.equal(refs[2].remote, 'origin');
});

test('parseNameStatus handles renames', () => {
  assert.deepEqual(parseNameStatus('M\0a.ts\0R100\0old.ts\0new.ts\0A\0b c.ts\0'), [
    { status: 'M', path: 'a.ts' },
    { status: 'R', path: 'new.ts', oldPath: 'old.ts' },
    { status: 'A', path: 'b c.ts' },
  ]);
});

test('remote helpers', () => {
  assert.deepEqual(splitRemoteBranch('origin/feature/x', ['origin']), { remote: 'origin', branch: 'feature/x' });
  assert.deepEqual(splitRemoteBranch('team/fork/main', ['team', 'team/fork']), { remote: 'team/fork', branch: 'main' });
  assert.deepEqual(
    pushArgs({ remote: 'origin', source: 'main', target: 'main', force: true, tags: false, setUpstream: true }),
    ['push', '--force-with-lease', '--set-upstream', 'origin', 'main:refs/heads/main'],
  );
  assert.equal(classifyRemoteFailure(' ! [rejected] main -> main (fetch first)'), 'rejected');
  assert.equal(classifyRemoteFailure('fatal: could not read Username for https://x: terminal prompts disabled'), 'auth');
  assert.equal(classifyRemoteFailure('fatal: repository not found'), 'other');
});

test('findReviewLink recognizes hosting service hints', async () => {
  const { findReviewLink } = await import('../src/git/services/remoteService');
  const gitlab = 'remote: To create a merge request for x, visit:\nremote:   https://gitlab.com/g/p/-/merge_requests/new?merge_request%5Bsource_branch%5D=x\nremote:';
  assert.deepEqual(findReviewLink(gitlab), {
    url: 'https://gitlab.com/g/p/-/merge_requests/new?merge_request%5Bsource_branch%5D=x',
    existing: false,
  });
  assert.equal(findReviewLink('remote: View merge request for x:\nremote:   https://gitlab.com/g/p/-/merge_requests/42')?.existing, true);
  assert.equal(findReviewLink('remote:      https://github.com/o/r/pull/new/feature')?.existing, false);
  assert.equal(findReviewLink('To github.com:o/r.git\n   abc..def  main -> main'), undefined);
});
