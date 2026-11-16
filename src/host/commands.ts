import * as vscode from 'vscode';
import { shortHash } from '../git/models';
import type { Repository } from '../git/repository';
import type { RepositoryManager } from './repositoryManager';
import { settings } from './settings';
import type { Interaction } from './ui/interaction';
import type { OperationRunner } from './ui/operationRunner';

interface Deps {
  ui: Interaction;
  ops: OperationRunner;
}

/** Puts the current branch back where it was before its last commit, amend, rebase, squash, reset or merge. */
export async function undoLastOperation(repo: Repository, { ui, ops }: Deps): Promise<void> {
  const { branch } = await repo.refs.head();
  const operation = branch ? await repo.history.lastOperation(branch) : undefined;
  if (!branch || !operation) {
    void vscode.window.showInformationMessage(branch ? `Nothing to undo on ${branch}.` : 'Undo needs a checked out branch.');
    return;
  }
  const [target] = await repo.log.byHashes([operation.previous]);
  const confirmed = await ui.confirm(
    `Undo "${operation.description}"?`,
    `${branch} goes back to ${shortHash(operation.previous)} "${target?.subject ?? ''}". Uncommitted changes are kept. Run Undo again to redo.`,
    'Undo',
  );
  if (!confirmed) return;
  await ops.run(repo, 'Undoing last operation', () => repo.history.undo(operation), {
    success: `${branch} is back at ${shortHash(operation.previous)}`,
  });
}

/** Deletes local branches that are merged into the current one or whose tracked branch is gone. */
export async function cleanupBranches(repo: Repository, { ops }: Deps): Promise<void> {
  const [snapshot, mergedOutput] = await Promise.all([
    repo.snapshot(),
    repo.read(['branch', '--merged', 'HEAD', '--format=%(refname:short)']).catch(() => ''),
  ]);
  const merged = new Set(mergedOutput.split('\n').filter(Boolean));
  const keep = new Set(settings.protectedBranches());
  const candidates = snapshot.refs
    .filter((ref) => ref.kind === 'local' && !ref.current && !keep.has(ref.name))
    .map((ref) => ({ ref, gone: ref.upstream?.gone ?? false, merged: merged.has(ref.name) }))
    .filter((candidate) => candidate.gone || candidate.merged);
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage('No merged or orphaned branches to clean up.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    candidates.map((candidate) => ({
      label: candidate.ref.name,
      description: [candidate.merged && `merged into ${snapshot.head.branch ?? 'HEAD'}`, candidate.gone && 'remote branch is gone']
        .filter(Boolean)
        .join(', '),
      // Unmerged branches (squash-merged upstream) need a deliberate tick.
      picked: candidate.merged,
      name: candidate.ref.name,
    })),
    { title: 'Delete Local Branches', canPickMany: true, placeHolder: 'Branches to delete' },
  );
  if (!picked?.length) return;
  await ops.run(
    repo,
    'Deleting branches',
    async () => {
      for (const item of picked) await repo.branches.delete(item.name, true);
    },
    { success: `Deleted ${picked.length} branch(es)` },
  );
}

export async function stashChanges(repo: Repository, { ops }: Deps): Promise<void> {
  const message = await vscode.window.showInputBox({ title: 'Stash Changes', placeHolder: 'Message (optional)' });
  if (message === undefined) return;
  let stashed = false;
  const ok = await ops.run(repo, 'Stashing changes', async () => {
    stashed = await repo.stash.push(message.trim() || undefined);
  });
  if (ok) vscode.window.setStatusBarMessage(stashed ? '$(check) Changes stashed' : 'No local changes to stash', 5000);
}

export async function unstashChanges(repo: Repository, { ui, ops }: Deps): Promise<void> {
  const entries = await repo.stash.list();
  if (entries.length === 0) {
    void vscode.window.showInformationMessage('No stashes.');
    return;
  }
  const entry = await ui.pick(
    'Unstash Changes',
    entries.map((item) => ({ label: item.message, description: `${item.ref} · ${new Date(item.date).toLocaleString()}`, value: item })),
  );
  if (!entry) return;
  const action = await ui.pick(entry.message, [
    { label: 'Pop', detail: 'Apply the stash and remove it', value: 'pop' as const },
    { label: 'Apply', detail: 'Apply the stash and keep it', value: 'apply' as const },
    { label: 'Drop', detail: 'Delete the stash without applying', value: 'drop' as const },
  ]);
  if (!action) return;
  if (action === 'drop' && !(await ui.confirm(`Drop "${entry.message}"?`, 'The stashed changes will be lost.', 'Drop'))) return;
  await ops.run(repo, `Stash ${action}`, () => repo.stash[action](entry.ref), { success: `Stash ${action} finished` });
}

/** Fetches the active repository in the background on a timer; failures stay silent. */
export function startAutoFetch(repos: RepositoryManager): vscode.Disposable {
  let busy = false;
  let last = Date.now();
  const timer = setInterval(async () => {
    const minutes = settings.autoFetchMinutes();
    const repo = repos.active;
    if (busy || !repo || minutes === 0 || !vscode.window.state.focused || Date.now() - last < minutes * 60_000) return;
    busy = true;
    last = Date.now();
    try {
      const [remotes, operation] = await Promise.all([repo.refs.remotes(), repo.sequencer.state()]);
      if (remotes.length > 0 && !operation) await repo.remotes.fetchAll();
    } catch {
      // Offline or unauthenticated: the explicit Fetch command reports problems.
    } finally {
      busy = false;
    }
  }, 30_000);
  return { dispose: () => clearInterval(timer) };
}
