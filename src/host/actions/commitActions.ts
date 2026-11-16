import { shortHash, type Commit, type ResetMode } from '../../git/models';
import { WORKING_TREE } from '../ui/diffPresenter';
import { SelectionChanges } from '../selectionChanges';
import type { ActionEnv, ActionGroups, GitAction } from './action';

/** One or more commits selected in a log. */
export interface CommitSelection {
  /** In log order: newest first. */
  commits: Commit[];
  /** All selected commits are ancestors of HEAD, so history-editing actions apply. */
  inCurrentBranch: boolean;
}

type CommitAction = GitAction<CommitSelection>;

const single = (selection: CommitSelection) => selection.commits.length === 1;
const hashes = (selection: CommitSelection) => selection.commits.map((commit) => commit.hash);
const plural = (selection: CommitSelection, word: string) => (single(selection) ? word : `${word}s`);
const isHead = (selection: CommitSelection, env: ActionEnv) =>
  single(selection) && selection.commits[0].hash === env.snapshot.head.hash;
const notInBranch = (selection: CommitSelection) =>
  selection.inCurrentBranch ? undefined : 'Available only for commits in the current branch';
const hasMerge = (selection: CommitSelection) => selection.commits.some((commit) => commit.parents.length > 1);

/** Rewriting pushed commits requires a force push later; make sure that is intended. */
async function confirmRewrite(selection: CommitSelection, env: ActionEnv): Promise<boolean> {
  const oldest = selection.commits[selection.commits.length - 1];
  if (!(await env.repo.history.isPushed(oldest.hash))) return true;
  return env.ui.confirm(
    'Rewrite pushed commits?',
    'Some of these commits are already pushed. After changing them you will need a force push.',
    'Rewrite Anyway',
  );
}

const copyHash: CommitAction = {
  id: 'commit.copyHash',
  label: () => 'Copy Revision Number',
  run: (selection, env) => env.ui.copy(hashes(selection).join(' ')),
};

const cherryPick: CommitAction = {
  id: 'commit.cherryPick',
  label: () => 'Cherry-Pick',
  run: async (selection, env) => {
    const ordered = [...selection.commits].reverse();
    await env.ops.run(env.repo, 'Cherry-picking', () => env.repo.commits.cherryPick(ordered), {
      success: `Cherry-picked ${ordered.length} ${plural(selection, 'commit')}`,
    });
  },
};

const checkoutRevision: CommitAction = {
  id: 'commit.checkout',
  label: () => 'Checkout Revision',
  visible: single,
  run: async (selection, env) => {
    const { hash } = selection.commits[0];
    await env.ops.run(env.repo, `Checking out ${shortHash(hash)}`, () => env.repo.branches.checkoutDetached(hash), {
      success: `Checked out ${shortHash(hash)}`,
    });
  },
};

const showDiff: CommitAction = {
  id: 'commit.showDiff',
  label: () => 'Show Diff',
  run: (selection, env) => new SelectionChanges(env.repo, env.diffs).openAll(hashes(selection)),
};

const compareWithLocal: CommitAction = {
  id: 'commit.compareWithLocal',
  label: () => 'Compare with Local',
  visible: single,
  run: async (selection, env) => {
    const { hash } = selection.commits[0];
    const changes = await env.repo.diff.againstWorkingTree(hash);
    await env.diffs.showAll(
      env.repo,
      changes.map((change) => ({ path: change.path, oldPath: change.oldPath, left: hash, right: WORKING_TREE })),
      `${shortHash(hash)} ↔ Working Tree`,
    );
  },
};

const RESET_MODES: { label: string; detail: string; value: ResetMode }[] = [
  { label: 'Soft', detail: 'Files stay as they are; the differences become staged changes.', value: 'soft' },
  { label: 'Mixed', detail: 'Files stay as they are; the differences become unstaged changes.', value: 'mixed' },
  { label: 'Hard', detail: 'Files are reverted to the selected commit. Local changes are lost.', value: 'hard' },
  { label: 'Keep', detail: 'Files are reverted to the selected commit, local changes are kept.', value: 'keep' },
];

const reset: CommitAction = {
  id: 'commit.reset',
  label: () => 'Reset Current Branch to Here…',
  visible: single,
  run: async (selection, env) => {
    const { hash } = selection.commits[0];
    const mode = await env.ui.pick(`Reset ${env.snapshot.head.branch ?? 'HEAD'} to ${shortHash(hash)}`, RESET_MODES);
    if (!mode) return;
    await env.ops.run(env.repo, `Resetting to ${shortHash(hash)}`, () => env.repo.commits.reset(hash, mode), {
      success: `Reset to ${shortHash(hash)} (${mode})`,
    });
  },
};

const revert: CommitAction = {
  id: 'commit.revert',
  label: (selection) => `Revert ${plural(selection, 'Commit')}`,
  run: async (selection, env) => {
    await env.ops.run(env.repo, 'Reverting', () => env.repo.commits.revert(selection.commits), {
      success: `Reverted ${selection.commits.length} ${plural(selection, 'commit')}`,
    });
  },
};

const undo: CommitAction = {
  id: 'commit.undo',
  label: () => 'Undo Commit…',
  visible: (selection, env) => isHead(selection, env) && selection.commits[0].parents.length === 1,
  run: async (selection, env) => {
    if (!(await confirmRewrite(selection, env))) return;
    await env.ops.run(env.repo, 'Undoing commit', () => env.repo.commits.undoLast(), {
      success: 'Commit undone; its changes are staged',
    });
  },
};

const reword: CommitAction = {
  id: 'commit.reword',
  label: () => 'Edit Commit Message…',
  visible: single,
  disabled: (selection) => notInBranch(selection) ?? (hasMerge(selection) ? 'Not available for merge commits' : undefined),
  run: async (selection, env) => {
    const { hash } = selection.commits[0];
    const [details] = await env.repo.log.details([hash]);
    const message = await env.ui.editMessage({ title: 'Edit Commit Message', initial: details.message, confirmLabel: 'OK' });
    if (!message || message === details.message || !(await confirmRewrite(selection, env))) return;
    await env.ops.run(env.repo, 'Changing commit message', () => env.repo.history.reword(hash, message), {
      success: 'Commit message changed',
    });
  },
};

const fixup: CommitAction = {
  id: 'commit.fixup',
  label: () => 'Fixup with Local Changes',
  visible: single,
  disabled: (selection) => notInBranch(selection) ?? (hasMerge(selection) ? 'Not available for merge commits' : undefined),
  run: async (selection, env) => {
    const { hash, subject } = selection.commits[0];
    const changes = (await env.repo.workingTree.status()).filter((change) => !change.untracked);
    if (changes.length === 0) {
      env.ui.info('No local changes to fix the commit up with');
      return;
    }
    const confirmed = await env.ui.confirm(
      `Add ${changes.length} changed file(s) to "${subject}"?`,
      'All tracked local changes are melded into the selected commit.',
      'Fixup',
    );
    if (!confirmed || !(await confirmRewrite(selection, env))) return;
    await env.ops.run(env.repo, 'Fixing up commit', () => env.repo.history.fixup(hash), {
      success: `Local changes added to ${shortHash(hash)}`,
    });
  },
};

const squash: CommitAction = {
  id: 'commit.squash',
  label: () => 'Squash Commits…',
  visible: (selection) => selection.commits.length > 1,
  disabled: (selection) => notInBranch(selection) ?? (hasMerge(selection) ? 'Merge commits cannot be squashed' : undefined),
  run: async (selection, env) => {
    const details = await env.repo.log.details(hashes(selection));
    const initial = details.reverse().map((commit) => commit.message).join('\n\n');
    const message = await env.ui.editMessage({ title: `Squash ${details.length} Commits`, initial, confirmLabel: 'Squash' });
    if (!message || !(await confirmRewrite(selection, env))) return;
    await env.ops.run(env.repo, 'Squashing commits', () => env.repo.history.squash(hashes(selection), message), {
      success: `Squashed ${details.length} commits`,
    });
  },
};

const drop: CommitAction = {
  id: 'commit.drop',
  label: (selection) => `Drop ${plural(selection, 'Commit')}`,
  disabled: (selection) => notInBranch(selection) ?? (hasMerge(selection) ? 'Merge commits cannot be dropped' : undefined),
  run: async (selection, env) => {
    const count = selection.commits.length;
    const subject = single(selection) ? `"${selection.commits[0].subject}"` : `${count} commits`;
    const confirmed = await env.ui.confirm(`Drop ${subject}?`, 'The changes made by the dropped commits are removed from the branch.', 'Drop');
    if (!confirmed || !(await confirmRewrite(selection, env))) return;
    await env.ops.run(env.repo, 'Dropping commits', () => env.repo.history.drop(hashes(selection)), {
      success: `Dropped ${count} ${plural(selection, 'commit')}`,
    });
  },
};

const interactiveRebase: CommitAction = {
  id: 'commit.interactiveRebase',
  label: () => 'Interactively Rebase from Here…',
  visible: single,
  disabled: notInBranch,
  run: async (selection, env) => {
    const commit = selection.commits[0];
    env.workbench.runInTerminal(env.repo, `git rebase -i ${commit.parents.length > 0 ? `${commit.hash}^` : '--root'}`);
  },
};

const pushUpToHere: CommitAction = {
  id: 'commit.pushUpToHere',
  label: () => 'Push All up to Here…',
  visible: (selection, env) => single(selection) && env.snapshot.head.branch !== undefined,
  disabled: notInBranch,
  run: (selection, env) => {
    const { hash } = selection.commits[0];
    return env.workbench.showPushDialog(env.repo, {
      revision: hash,
      label: `${env.snapshot.head.branch} up to ${shortHash(hash)}`,
      branch: env.snapshot.head.branch!,
    });
  },
};

const newBranch: CommitAction = {
  id: 'commit.newBranch',
  label: () => 'New Branch…',
  visible: single,
  run: async (selection, env) => {
    const { hash } = selection.commits[0];
    const existing = env.snapshot.refs.filter((ref) => ref.kind === 'local').map((ref) => ref.name);
    const answer = await env.ui.branchName(`New Branch at ${shortHash(hash)}`, existing);
    if (!answer) return;
    await env.ops.run(env.repo, `Creating ${answer.name}`, () => env.repo.branches.create(answer.name, hash, answer.checkout), {
      success: `Created branch ${answer.name}`,
    });
  },
};

const newTag: CommitAction = {
  id: 'commit.newTag',
  label: () => 'New Tag…',
  visible: single,
  run: async (selection, env) => {
    const { hash } = selection.commits[0];
    const existing = env.snapshot.refs.filter((ref) => ref.kind === 'tag').map((ref) => ref.name);
    const name = await env.ui.input({
      title: `New Tag at ${shortHash(hash)}`,
      placeholder: 'Tag name',
      validate: (value) => (existing.includes(value.trim()) ? `Tag '${value.trim()}' already exists` : undefined),
    });
    if (!name) return;
    await env.ops.run(env.repo, `Creating tag ${name}`, () => env.repo.branches.createTag(name, hash), {
      success: `Created tag ${name}`,
    });
  },
};

/** Context menu of the log, in IntelliJ order. */
export const commitActions: ActionGroups<CommitSelection> = [
  [copyHash],
  [cherryPick, checkoutRevision],
  [showDiff, compareWithLocal],
  [reset, revert, undo],
  [reword, fixup, squash, drop, interactiveRebase, pushUpToHere],
  [newBranch, newTag],
];
