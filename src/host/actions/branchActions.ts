import { GitError } from '../../git/executor';
import type { Ref } from '../../git/models';
import { splitRemoteBranch } from '../../git/services/refService';
import { WORKING_TREE } from '../ui/diffPresenter';
import { validateBranchName } from '../ui/interaction';
import type { ActionEnv, ActionGroups, GitAction } from './action';

type BranchAction = GitAction<Ref>;

const current = (env: ActionEnv) => env.snapshot.head.branch;
const localNames = (env: ActionEnv) => env.snapshot.refs.filter((ref) => ref.kind === 'local').map((ref) => ref.name);
const isOtherBranch = (ref: Ref, env: ActionEnv) => !ref.current && current(env) !== undefined;
const noun = (ref: Ref) => (ref.kind === 'tag' ? 'tag' : 'branch');

/** Switches the working tree to the ref, creating a tracking branch for remote branches. */
async function checkoutRef(ref: Ref, env: ActionEnv): Promise<void> {
  const { repo, snapshot } = env;
  if (ref.kind === 'local') return repo.branches.checkout(ref.name);
  if (ref.kind === 'tag') return repo.branches.checkoutDetached(ref.fullName);
  const local = splitRemoteBranch(ref.name, snapshot.remotes).branch;
  return localNames(env).includes(local) ? repo.branches.checkout(local) : repo.branches.checkoutTracking(local, ref.name);
}

/** Local changes block the checkout: offer to carry them over via stash, like IntelliJ's Smart Checkout. */
async function smartCheckout(ref: Ref, env: ActionEnv, error: GitError): Promise<boolean> {
  if (!/would be overwritten by checkout|commit your changes or stash them/i.test(error.output)) return false;
  const choice = await env.ui.choose(
    'Local changes would be overwritten by checkout',
    `Smart Checkout stashes your changes, checks out ${ref.name} and restores them there.`,
    'Smart Checkout',
  );
  if (!choice) return true;
  await env.repo.stash.push(`Smart checkout to ${ref.name}`);
  await checkoutRef(ref, env);
  await env.repo.stash.pop();
  return true;
}

const checkout: BranchAction = {
  id: 'branch.checkout',
  label: () => 'Checkout',
  visible: (ref) => !ref.current,
  run: async (ref, env) => {
    await env.ops.run(env.repo, `Checking out ${ref.name}`, () => checkoutRef(ref, env), {
      success: `Checked out ${ref.name}`,
      recover: (error) => smartCheckout(ref, env, error),
    });
  },
};

const newBranchFrom: BranchAction = {
  id: 'branch.newFrom',
  label: (ref) => `New Branch from '${ref.name}'…`,
  run: async (ref, env) => {
    const answer = await env.ui.branchName(`New Branch from ${ref.name}`, localNames(env));
    if (!answer) return;
    await env.ops.run(env.repo, `Creating ${answer.name}`, () => env.repo.branches.create(answer.name, ref.fullName, answer.checkout), {
      success: `Created branch ${answer.name}`,
    });
  },
};

const checkoutAndRebase: BranchAction = {
  id: 'branch.checkoutAndRebase',
  label: (_, env) => `Checkout and Rebase onto '${current(env)}'`,
  visible: (ref, env) => ref.kind !== 'tag' && isOtherBranch(ref, env),
  run: async (ref, env) => {
    const onto = current(env)!;
    await env.ops.run(
      env.repo,
      `Rebasing ${ref.name} onto ${onto}`,
      async () => {
        await checkoutRef(ref, env);
        await env.repo.branches.rebase(onto);
      },
      { success: `Checked out ${ref.name} and rebased it onto ${onto}` },
    );
  },
};

const compareWithCurrent: BranchAction = {
  id: 'branch.compare',
  label: (_, env) => `Compare with '${current(env)}'`,
  visible: isOtherBranch,
  run: async (ref, env) => {
    env.workbench.filterLog({
      revision: `refs/heads/${current(env)}..${ref.fullName}`,
      revisionLabel: `in ${ref.name}, not in ${current(env)}`,
    });
  },
};

const diffWithWorkingTree: BranchAction = {
  id: 'branch.diffWorkingTree',
  label: () => 'Show Diff with Working Tree',
  visible: (ref) => !ref.current,
  run: async (ref, env) => {
    const changes = await env.repo.diff.againstWorkingTree(ref.fullName);
    await env.diffs.showAll(
      env.repo,
      changes.map((change) => ({ path: change.path, oldPath: change.oldPath, left: ref.fullName, right: WORKING_TREE })),
      `${ref.name} ↔ Working Tree`,
    );
  },
};

const rebaseCurrentOnto: BranchAction = {
  id: 'branch.rebaseCurrentOnto',
  label: (ref, env) => `Rebase '${current(env)}' onto '${ref.name}'`,
  visible: isOtherBranch,
  run: async (ref, env) => {
    await env.ops.run(env.repo, `Rebasing onto ${ref.name}`, () => env.repo.branches.rebase(ref.fullName), {
      success: `Rebased ${current(env)} onto ${ref.name}`,
    });
  },
};

const mergeIntoCurrent: BranchAction = {
  id: 'branch.mergeIntoCurrent',
  label: (ref, env) => `Merge '${ref.name}' into '${current(env)}'`,
  visible: isOtherBranch,
  run: async (ref, env) => {
    await env.ops.run(env.repo, `Merging ${ref.name}`, () => env.repo.branches.merge(ref.name), {
      success: `Merged ${ref.name} into ${current(env)}`,
    });
  },
};

const pullInto = (method: 'rebase' | 'merge'): BranchAction => ({
  id: `branch.pull.${method}`,
  label: (_, env) => `Pull into '${current(env)}' Using ${method === 'rebase' ? 'Rebase' : 'Merge'}`,
  visible: (ref, env) => ref.kind === 'remote' && current(env) !== undefined,
  run: async (ref, env) => {
    const { remote, branch } = splitRemoteBranch(ref.name, env.snapshot.remotes);
    await env.ops.run(env.repo, `Pulling ${ref.name}`, () => env.repo.remotes.pullFrom(remote, branch, method), {
      success: `Pulled ${ref.name} into ${current(env)}`,
    });
  },
});

const update: BranchAction = {
  id: 'branch.update',
  label: () => 'Update',
  visible: (ref) => ref.kind === 'local',
  disabled: (ref) => (!ref.upstream ? 'No tracked branch' : ref.upstream.gone ? 'The tracked branch is gone' : undefined),
  run: async (ref, env) => {
    const { remote, branch } = splitRemoteBranch(ref.upstream!.name, env.snapshot.remotes);
    const task = ref.current
      ? () => env.repo.remotes.pull(env.workbench.updateMethod())
      : () => env.repo.remotes.fastForward(ref.name, remote, branch);
    await env.ops.run(env.repo, `Updating ${ref.name}`, task, { success: `Updated ${ref.name}` });
  },
};

const push: BranchAction = {
  id: 'branch.push',
  label: () => 'Push…',
  visible: (ref) => ref.kind === 'local',
  run: (ref, env) => env.workbench.showPushDialog(env.repo, { revision: ref.name, label: ref.name, branch: ref.name }),
};

const rename: BranchAction = {
  id: 'branch.rename',
  label: () => 'Rename…',
  visible: (ref) => ref.kind === 'local',
  run: async (ref, env) => {
    const name = await env.ui.input({
      title: `Rename Branch ${ref.name}`,
      value: ref.name,
      validate: (value) => (value.trim() === ref.name ? undefined : validateBranchName(value.trim(), localNames(env))),
    });
    if (!name || name === ref.name) return;
    await env.ops.run(env.repo, `Renaming ${ref.name}`, () => env.repo.branches.rename(ref.name, name), {
      success: `Renamed ${ref.name} to ${name}`,
    });
  },
};

const remove: BranchAction = {
  id: 'branch.delete',
  label: () => 'Delete',
  visible: (ref) => !ref.current,
  run: async (ref, env) => {
    const { repo, ui } = env;
    const done = { success: `Deleted ${noun(ref)} ${ref.name}` };
    if (ref.kind === 'remote') {
      const { remote, branch } = splitRemoteBranch(ref.name, env.snapshot.remotes);
      if (!(await ui.confirm(`Delete remote branch ${ref.name}?`, 'The branch will be removed from the remote.', 'Delete'))) return;
      await env.ops.run(repo, `Deleting ${ref.name}`, () => repo.branches.deleteRemote(remote, branch), done);
      return;
    }
    if (ref.kind === 'tag') {
      if (!(await ui.confirm(`Delete tag ${ref.name}?`, 'The tag is removed locally only.', 'Delete'))) return;
      await env.ops.run(repo, `Deleting ${ref.name}`, () => repo.branches.deleteTag(ref.name), done);
      return;
    }
    await env.ops.run(repo, `Deleting ${ref.name}`, () => repo.branches.delete(ref.name), {
      ...done,
      recover: async (error: GitError) => {
        if (!/not fully merged/.test(error.output)) return false;
        const confirmed = await ui.confirm(
          `Branch ${ref.name} is not fully merged`,
          'Its unmerged commits will only be reachable through the reflog.',
          'Delete Anyway',
        );
        if (confirmed) await repo.branches.delete(ref.name, true);
        // Declining is a decision, not a failure: nothing more to report either way.
        return true;
      },
    });
  },
};

/** Context menu of a branch or tag, in IntelliJ order. */
export const branchActions: ActionGroups<Ref> = [
  [checkout, newBranchFrom, checkoutAndRebase],
  [compareWithCurrent, diffWithWorkingTree],
  [rebaseCurrentOnto, mergeIntoCurrent, pullInto('rebase'), pullInto('merge')],
  [update, push],
  [rename, remove],
];
