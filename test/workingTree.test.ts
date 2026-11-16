import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GitExecutor } from '../src/git/executor';
import { Repository } from '../src/git/repository';

function createRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gitjet-wt-')));
  const sh = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const write = (name: string, content: string) => writeFileSync(join(dir, name), content);
  sh('init', '-q', '-b', 'main');
  sh('config', 'user.name', 'Test');
  sh('config', 'user.email', 'test@example.com');
  sh('config', 'commit.gpgsign', 'false');
  for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) write(name, name);
  sh('add', '.');
  sh('commit', '-q', '-m', 'base');
  return { repo: new Repository(dir, new GitExecutor(dir)), dir, sh, write };
}

const summary = async (repo: Repository) =>
  (await repo.workingTree.status()).map((c) => `${c.untracked ? '?' : c.status} ${c.oldPath ? `${c.oldPath}>` : ''}${c.path}`);

test('status merges index and working tree into one list', async () => {
  const { repo, dir, sh, write } = createRepo();
  write('a.txt', 'changed');
  write('b.txt', 'staged');
  sh('add', 'b.txt');
  rmSync(join(dir, 'c.txt'));
  sh('mv', 'd.txt', 'moved.txt');
  write('new file.txt', 'new');
  assert.deepEqual(await summary(repo), ['M a.txt', 'M b.txt', 'D c.txt', 'R d.txt>moved.txt', '? new file.txt']);
});

test('commit takes only the chosen files and leaves the rest as it was', async () => {
  const { repo, dir, sh, write } = createRepo();
  write('a.txt', 'changed');
  write('b.txt', 'staged but not chosen');
  sh('add', 'b.txt');
  rmSync(join(dir, 'c.txt'));
  sh('mv', 'd.txt', 'moved.txt');
  write('new.txt', 'new');
  write('other.txt', 'stays unversioned');

  const changes = (await repo.workingTree.status()).filter((c) => !['b.txt', 'other.txt'].includes(c.path));
  await repo.workingTree.commit({ changes, message: 'pick some\n\nbody', amend: false });

  assert.equal(sh('log', '-1', '--format=%B'), 'pick some\n\nbody');
  assert.deepEqual(sh('show', '--name-status', '--format=', '-M', 'HEAD').split('\n'), [
    'M\ta.txt',
    'D\tc.txt',
    'R100\td.txt\tmoved.txt',
    'A\tnew.txt',
  ]);
  assert.deepEqual(await summary(repo), ['M b.txt', '? other.txt']);
  assert.equal(sh('diff', '--cached', '--name-only'), 'b.txt');
});

test('amend with and without files', async () => {
  const { repo, sh, write } = createRepo();
  write('a.txt', 'staged, must stay out');
  sh('add', 'a.txt');
  await repo.workingTree.commit({ changes: [], message: 'renamed base', amend: true });
  assert.equal(await repo.workingTree.lastMessage(), 'renamed base');
  assert.equal(sh('rev-list', '--count', 'HEAD'), '1');
  assert.deepEqual(await summary(repo), ['M a.txt']);

  await repo.workingTree.commit({ changes: await repo.workingTree.status(), message: 'with a', amend: true });
  assert.equal(sh('rev-list', '--count', 'HEAD'), '1');
  assert.deepEqual(await summary(repo), []);
});

test('rollback restores, un-adds and un-renames', async () => {
  const { repo, dir, sh, write } = createRepo();
  write('a.txt', 'changed');
  rmSync(join(dir, 'b.txt'));
  sh('mv', 'd.txt', 'moved.txt');
  write('added.txt', 'added');
  sh('add', 'added.txt');
  write('untracked.txt', 'keep');

  await repo.workingTree.rollback(await repo.workingTree.status());
  assert.deepEqual(await summary(repo), ['? added.txt', '? untracked.txt']);
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'a.txt');
  assert.equal(existsSync(join(dir, 'b.txt')), true);
  assert.equal(existsSync(join(dir, 'd.txt')), true);
  assert.equal(existsSync(join(dir, 'moved.txt')), false);
});

test('concluding a merge commits the whole index', async () => {
  const { repo, sh, write } = createRepo();
  sh('checkout', '-q', '-b', 'side');
  write('a.txt', 'side');
  sh('commit', '-qam', 'side');
  sh('checkout', '-q', 'main');
  write('a.txt', 'main');
  sh('commit', '-qam', 'main');
  assert.throws(() => sh('merge', 'side'));
  assert.deepEqual(await summary(repo), ['U a.txt']);
  write('a.txt', 'resolved');
  await repo.workingTree.commit({ changes: await repo.workingTree.status(), message: 'merged', amend: false });
  assert.equal(await repo.sequencer.state(), undefined);
  assert.equal(sh('rev-list', '--count', '--merges', 'HEAD'), '1');
});
