import { BoundedCache } from '../../core/async';
import type { FileChange } from '../models';
import { parseNameStatus } from '../parsers';
import type { GitRunner } from '../runner';

export class DiffService {
  private readonly commitChanges = new BoundedCache<string, FileChange[]>(500);

  constructor(private readonly git: GitRunner) {}

  /** Files changed by a commit relative to its first parent. */
  async ofCommit(hash: string): Promise<FileChange[]> {
    const cached = this.commitChanges.get(hash);
    if (cached) return cached;
    const stdout = await this.git.read([
      'diff-tree',
      '-r',
      '-z',
      '-M',
      '--root',
      '--no-commit-id',
      '--name-status',
      '--diff-merges=first-parent',
      hash,
    ]);
    const changes = parseNameStatus(stdout);
    this.commitChanges.set(hash, changes);
    return changes;
  }

  async between(from: string, to: string): Promise<FileChange[]> {
    return parseNameStatus(await this.git.read(['diff', '-z', '-M', '--name-status', from, to, '--']));
  }

  /** Differences between a revision and the working tree. */
  async againstWorkingTree(revision: string): Promise<FileChange[]> {
    return parseNameStatus(await this.git.read(['diff', '-z', '-M', '--name-status', revision, '--']));
  }

  /** File content at a revision; empty when the file does not exist there. */
  async content(revision: string, path: string): Promise<string> {
    const result = await this.git.probe(['show', `${revision}:${path}`], { allowExitCodes: [1, 128] });
    return result.exitCode === 0 ? result.stdout : '';
  }
}
