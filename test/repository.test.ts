import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GitExecutor } from '../src/git/executor';
import { Repository } from '../src/git/repository';

/** A throwaway repository with one file per commit, so commits never conflict. */
function createRepo(subjects: string[]): { repo: Repository; dir: string; sh: (...args: string[]) => string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gitjet-test-')));
  const sh = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  sh('init', '-q', '-b', 'main');
  sh('config', 'user.name', 'Test');
  sh('config', 'user.email', 'test@example.com');
  sh('config', 'commit.gpgsign', 'false');
  for (const subject of subjects) {
    writeFileSync(join(dir, `${subject}.txt`), subject);
    sh('add', '.');
    sh('commit', '-q', '-m', subject);
  }
  return { repo: new Repository(dir, new GitExecutor(dir)), dir, sh };
}

const subjects = async (repo: Repository) => (await repo.log.query({ skip: 0, limit: 100 })).map((c) => c.subject);

test('snapshot of an empty repository', async () => {
  const { repo } = createRepo([]);
  const snapshot = await repo.snapshot();
  assert.equal(snapshot.head.branch, 'main');
  assert.equal(snapshot.head.hash, undefined);
  assert.deepEqual(await repo.log.query({ skip: 0, limit: 10 }), []);
});

test('log, refs and commit changes', async () => {
  const { repo, sh } = createRepo(['one', 'two']);
  sh('tag', '-a', 'v1', '-m', 'release');
  sh('branch', 'feature', 'HEAD~1');
  const snapshot = await repo.snapshot();
  const head = sh('rev-parse', 'HEAD');
  assert.deepEqual(snapshot.refs.map((ref) => `${ref.kind}:${ref.name}`), ['local:feature', 'local:main', 'tag:v1']);
  assert.equal(snapshot.refs.find((ref) => ref.name === 'v1')?.hash, head);
  assert.equal(snapshot.refs.find((ref) => ref.name === 'main')?.current, true);

  assert.deepEqual(await subjects(repo), ['two', 'one']);
  assert.deepEqual((await repo.log.query({ skip: 0, limit: 10, text: 'ON' })).map((c) => c.subject), ['one']);
  assert.deepEqual((await repo.log.query({ skip: 0, limit: 10, text: head.slice(0, 8) })).map((c) => c.hash), [head]);
  assert.deepEqual(await repo.diff.ofCommit(head), [{ status: 'A', path: 'two.txt' }]);
  const [details] = await repo.log.details([head]);
  assert.equal(details.message, 'two');
  assert.deepEqual(await repo.log.containingBranches(head), ['main']);
});

test('squash melds non-adjacent commits and keeps uncommitted changes', async () => {
  const { repo, dir, sh } = createRepo(['a', 'b', 'c', 'd']);
  writeFileSync(join(dir, 'a.txt'), 'dirty');
  const [, c, , a] = await repo.log.query({ skip: 0, limit: 10 });
  await repo.history.squash([c.hash, a.hash], 'a+c\n\nbody');
  assert.deepEqual(await subjects(repo), ['d', 'b', 'a+c']);
  assert.equal(sh('log', '-1', '--format=%B', 'HEAD~2'), 'a+c\n\nbody');
  assert.equal(sh('show', '--name-only', '--format=', 'HEAD~2'), 'a.txt\nc.txt');
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'dirty');
  assert.equal(await repo.sequencer.state(), undefined);
});

test('squash including the root commit', async () => {
  const { repo } = createRepo(['a', 'b', 'c']);
  const [, b, a] = await repo.log.query({ skip: 0, limit: 10 });
  await repo.history.squash([b.hash, a.hash], 'ab');
  assert.deepEqual(await subjects(repo), ['c', 'ab']);
});

test('reword an old commit and HEAD', async () => {
  const { repo, dir, sh } = createRepo(['a', 'b', 'c']);
  const [c, b] = await repo.log.query({ skip: 0, limit: 10 });
  await repo.history.reword(b.hash, "it's B");
  assert.deepEqual(await subjects(repo), ['c', "it's B", 'a']);

  writeFileSync(join(dir, 'staged.txt'), 'staged');
  sh('add', '.');
  assert.notEqual(sh('rev-parse', 'HEAD'), c.hash);
  await repo.history.reword(sh('rev-parse', 'HEAD'), 'C!');
  assert.deepEqual(await subjects(repo), ['C!', "it's B", 'a']);
  assert.equal(sh('diff', '--cached', '--name-only'), 'staged.txt');
});

test('drop commits', async () => {
  const { repo } = createRepo(['a', 'b', 'c']);
  const [c, b] = await repo.log.query({ skip: 0, limit: 10 });
  await repo.history.drop([b.hash]);
  assert.deepEqual(await subjects(repo), ['c', 'a']);
  await repo.history.drop([(await repo.log.query({ skip: 0, limit: 1 }))[0].hash]);
  assert.deepEqual(await subjects(repo), ['a']);
  assert.notEqual(c.hash, undefined);
});

test('history edits refuse to cross merges and foreign commits', async () => {
  const { repo, dir, sh } = createRepo(['a', 'b']);
  sh('checkout', '-q', '-b', 'side', 'HEAD~1');
  writeFileSync(join(dir, 'side.txt'), 'side');
  sh('add', '.');
  sh('commit', '-q', '-m', 'side');
  const side = sh('rev-parse', 'HEAD');
  sh('checkout', '-q', 'main');
  await assert.rejects(repo.history.drop([side]), /not in the current branch/);
  sh('merge', '-q', '--no-ff', '--no-edit', 'side');
  const a = sh('rev-parse', 'HEAD~1~1');
  await assert.rejects(repo.history.reword(a, 'x'), /merge commits/);
});

test('cherry-pick, conflict detection and abort', async () => {
  const { repo, dir, sh } = createRepo(['a']);
  sh('checkout', '-q', '-b', 'side');
  writeFileSync(join(dir, 'a.txt'), 'side change');
  sh('commit', '-qam', 'side change');
  writeFileSync(join(dir, 'new.txt'), 'new');
  sh('add', '.');
  sh('commit', '-qm', 'new file');
  const [newFile, sideChange] = await repo.log.query({ skip: 0, limit: 2 });
  sh('checkout', '-q', 'main');

  await repo.commits.cherryPick([newFile]);
  const onMain = await repo.log.query({ skip: 0, limit: 10, revisions: ['main'] });
  assert.deepEqual(onMain.map((c) => c.subject), ['new file', 'a']);

  writeFileSync(join(dir, 'a.txt'), 'main change');
  sh('commit', '-qam', 'main change');
  await assert.rejects(repo.commits.cherryPick([sideChange]));
  assert.equal(await repo.sequencer.state(), 'cherry-pick');
  assert.deepEqual(await repo.sequencer.unresolvedFiles(), ['a.txt']);
  await repo.sequencer.abort('cherry-pick');
  assert.equal(await repo.sequencer.state(), undefined);
});

test('outgoing commits and push to a bare remote', async () => {
  const { repo, dir, sh } = createRepo(['a', 'b']);
  const remote = mkdtempSync(join(tmpdir(), 'gitjet-remote-'));
  execFileSync('git', ['init', '-q', '--bare', remote]);
  sh('remote', 'add', 'origin', remote);

  let outgoing = await repo.remotes.outgoing('main', 'origin', 'main');
  assert.equal(outgoing.isNew, true);
  assert.deepEqual(outgoing.commits.map((c) => c.subject), ['b', 'a']);

  await repo.remotes.push({ remote: 'origin', source: 'main', target: 'main', force: false, tags: false, setUpstream: true });
  writeFileSync(join(dir, 'c.txt'), 'c');
  sh('add', '.');
  sh('commit', '-qm', 'c');
  outgoing = await repo.remotes.outgoing('main', 'origin', 'main');
  assert.equal(outgoing.isNew, false);
  assert.deepEqual(outgoing.commits.map((c) => c.subject), ['c']);
  const main = (await repo.snapshot()).refs.find((ref) => ref.name === 'main');
  assert.deepEqual(main?.upstream, { name: 'origin/main', ahead: 1, behind: 0, gone: false });
  assert.equal(await repo.history.isPushed(sh('rev-parse', 'HEAD~1')), true);
  assert.equal(await repo.history.isPushed(sh('rev-parse', 'HEAD')), false);
});

test('diff for a generated message covers only the chosen files, plus the last commit on amend', async () => {
  const { repo, dir, sh } = createRepo(['a', 'b']);
  writeFileSync(join(dir, 'a.txt'), 'changed a');
  writeFileSync(join(dir, 'b.txt'), 'changed b');
  writeFileSync(join(dir, 'new.txt'), 'brand new');
  const changes = await repo.workingTree.status();
  const pick = (...paths: string[]) => changes.filter((change) => paths.includes(change.path));

  const diff = await repo.workingTree.diffOf(pick('a.txt', 'new.txt'), false);
  assert.match(diff, /\+changed a/);
  assert.match(diff, /\+brand new/);
  assert.doesNotMatch(diff, /changed b/);

  const amended = await repo.workingTree.diffOf(pick('a.txt'), true);
  assert.match(amended, /b\/b\.txt[\s\S]*\+b/);
  assert.match(amended, /\+changed a/);

  sh('commit', '-qam', 'subject\n\nbody line');
  assert.deepEqual(await repo.log.recentMessages(2), ['subject\n\nbody line', 'b']);
  assert.deepEqual(await repo.log.recentMessages(5, 1), ['b', 'a']);
});

test('a commit dropped after pushing is listed as discarded and removed by a force push', async () => {
  const { repo, sh } = createRepo(['a', 'b', 'c']);
  const remote = mkdtempSync(join(tmpdir(), 'gitjet-remote-'));
  execFileSync('git', ['init', '-q', '--bare', remote]);
  sh('remote', 'add', 'origin', remote);
  await repo.remotes.push({ remote: 'origin', source: 'main', target: 'main', force: false, tags: false, setUpstream: true });

  const [c] = await repo.log.query({ skip: 0, limit: 1 });
  sh('reset', '-q', '--hard', 'HEAD~1');
  let outgoing = await repo.remotes.outgoing('main', 'origin', 'main');
  assert.deepEqual(outgoing.commits, []);
  assert.deepEqual(outgoing.discarded.map((commit) => commit.hash), [c.hash]);

  await assert.rejects(repo.remotes.push({ remote: 'origin', source: 'main', target: 'main', force: false, tags: false, setUpstream: false }));
  await repo.remotes.push({ remote: 'origin', source: 'main', target: 'main', force: true, tags: false, setUpstream: false });
  outgoing = await repo.remotes.outgoing('main', 'origin', 'main');
  assert.deepEqual(outgoing.discarded, []);
  assert.equal(execFileSync('git', ['--git-dir', remote, 'log', '--format=%s', 'main'], { encoding: 'utf8' }).trim(), 'b\na');
});

test('fixup melds local changes into an older commit', async () => {
  const { repo, dir, sh } = createRepo(['a', 'b', 'c']);
  const [, b] = await repo.log.query({ skip: 0, limit: 10 });
  writeFileSync(join(dir, 'a.txt'), 'fixed');
  writeFileSync(join(dir, 'untracked.txt'), 'stays');
  await repo.history.fixup(b.hash);
  assert.deepEqual(await subjects(repo), ['c', 'b', 'a']);
  assert.equal(sh('show', '--name-only', '--format=', 'HEAD~1'), 'a.txt\nb.txt');
  assert.equal(sh('status', '--porcelain'), '?? untracked.txt');
});

test('undo steps back over squash, amend and commit; undo again redoes', async () => {
  const { repo, dir, sh } = createRepo(['a', 'b', 'c']);
  const before = sh('rev-parse', 'HEAD');
  const [c, b] = await repo.log.query({ skip: 0, limit: 10 });
  await repo.history.squash([c.hash, b.hash], 'b+c');
  const squashed = sh('rev-parse', 'HEAD');

  let operation = await repo.history.lastOperation('main');
  assert.match(operation!.description, /^rebase/);
  await repo.history.undo(operation!);
  assert.equal(sh('rev-parse', 'HEAD'), before);
  await repo.history.undo((await repo.history.lastOperation('main'))!);
  assert.equal(sh('rev-parse', 'HEAD'), squashed);

  writeFileSync(join(dir, 'd.txt'), 'd');
  sh('add', '.');
  sh('commit', '-qm', 'd');
  operation = await repo.history.lastOperation('main');
  await repo.history.undo(operation!);
  assert.equal(sh('rev-parse', 'HEAD'), squashed);
  assert.equal(sh('diff', '--cached', '--name-only'), 'd.txt');
});

test('stash round trip', async () => {
  const { repo, dir, sh } = createRepo(['a']);
  assert.equal(await repo.stash.push(), false);
  writeFileSync(join(dir, 'a.txt'), 'dirty');
  writeFileSync(join(dir, 'new.txt'), 'new');
  assert.equal(await repo.stash.push('wip'), true);
  assert.equal(sh('status', '--porcelain'), '');
  const [entry] = await repo.stash.list();
  assert.match(entry.message, /wip/);
  await repo.stash.pop(entry.ref);
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'dirty');
  assert.deepEqual(await repo.stash.list(), []);
});
