import type { Commit, ResetMode } from '../models';
import type { GitRunner } from '../runner';

export class CommitService {
  constructor(private readonly git: GitRunner) {}

  /** @param commits in the order they should be applied (oldest first) */
  async cherryPick(commits: readonly Commit[]): Promise<void> {
    await this.git.write(['cherry-pick', ...mainlineFlag(commits), ...commits.map((c) => c.hash)]);
  }

  /** @param commits in the order they should be reverted (newest first) */
  async revert(commits: readonly Commit[]): Promise<void> {
    await this.git.write(['revert', '--no-edit', ...mainlineFlag(commits), ...commits.map((c) => c.hash)]);
  }

  async reset(revision: string, mode: ResetMode): Promise<void> {
    await this.git.write(['reset', `--${mode}`, revision]);
  }

  /** Removes the last commit, keeping its changes staged. */
  async undoLast(): Promise<void> {
    await this.reset('HEAD~1', 'soft');
  }
}

function mainlineFlag(commits: readonly Commit[]): string[] {
  const merges = commits.filter((commit) => commit.parents.length > 1).length;
  if (merges === 0) return [];
  if (merges < commits.length) {
    throw new Error('Select either merge commits or regular commits, not both at once.');
  }
  return ['-m', '1'];
}
