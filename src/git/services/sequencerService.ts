import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { OperationKind } from '../models';
import type { GitRunner } from '../runner';

/** The in-progress multi-step operation (rebase, merge, cherry-pick, revert), if any. */
export class SequencerService {
  constructor(private readonly git: GitRunner) {}

  async state(): Promise<OperationKind | undefined> {
    const gitDir = await this.git.gitDir();
    const has = (name: string) => existsSync(join(gitDir, name));
    if (has('rebase-merge') || has('rebase-apply')) return 'rebase';
    if (has('CHERRY_PICK_HEAD')) return 'cherry-pick';
    if (has('REVERT_HEAD')) return 'revert';
    if (has('MERGE_HEAD')) return 'merge';
    return undefined;
  }

  async unresolvedFiles(): Promise<string[]> {
    const stdout = await this.git.read(['diff', '--name-only', '--diff-filter=U', '-z']);
    return stdout.split('\0').filter(Boolean);
  }

  async continue(operation: OperationKind): Promise<void> {
    await this.git.write(operation === 'merge' ? ['commit', '--no-edit'] : [operation, '--continue']);
  }

  async abort(operation: OperationKind): Promise<void> {
    await this.git.write([operation, '--abort']);
  }
}
