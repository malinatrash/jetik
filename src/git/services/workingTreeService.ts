import type { WorkingChange } from '../models';
import type { GitRunner } from '../runner';
import type { SequencerService } from './sequencerService';

/** Git's well-known empty tree: the base to diff against before the first commit. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export interface CommitRequest {
  /** Changes to include; everything else stays uncommitted, staged or not. */
  changes: readonly WorkingChange[];
  message: string;
  amend: boolean;
}

/** Local changes and committing them the IntelliJ way: pick files, not hunks of the index. */
export class WorkingTreeService {
  constructor(
    private readonly git: GitRunner,
    private readonly sequencer: SequencerService,
  ) {}

  async status(): Promise<WorkingChange[]> {
    return parseStatus(await this.git.read(['status', '--porcelain', '-z', '-uall']));
  }

  async commit(request: CommitRequest): Promise<void> {
    const unstaged = request.changes.filter((change) => !change.staged).map((change) => change.path);
    if (unstaged.length > 0) await this.git.write(['add', '-A', '--', ...unstaged]);

    const args = ['commit', '-F', '-'];
    if (request.amend) args.push('--amend');
    // Partial commits are impossible while a merge is being concluded: then the whole index goes in.
    if (!(await this.sequencer.state())) {
      const paths = request.changes.flatMap((change) => (change.oldPath ? [change.path, change.oldPath] : [change.path]));
      args.push('--only');
      if (paths.length > 0) args.push('--', ...paths);
    }
    await this.git.write(args, { stdin: request.message });
  }

  /** Discards the given changes. Unversioned files are left alone. */
  async rollback(changes: readonly WorkingChange[]): Promise<void> {
    const renamed = changes.filter((change) => change.oldPath);
    const added = changes.filter((change) => change.added && !change.oldPath);
    const restore = [
      ...changes.filter((change) => !change.untracked && !change.added && !change.oldPath).map((change) => change.path),
      ...renamed.map((change) => change.oldPath!),
    ];
    if (renamed.length > 0) await this.git.write(['rm', '-f', '-q', '--', ...renamed.map((change) => change.path)]);
    // A newly added file has nothing to go back to: it becomes unversioned again.
    if (added.length > 0) await this.git.write(['rm', '--cached', '-f', '-q', '--', ...added.map((change) => change.path)]);
    if (restore.length > 0) await this.git.write(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...restore]);
  }

  /**
   * Unified diff of what committing `changes` would record, to describe it in a message.
   * With `amend` the last commit's own changes come first, since the amended commit keeps them.
   */
  async diffOf(changes: readonly WorkingChange[], amend: boolean): Promise<string> {
    const hasHead = (await this.git.probe(['rev-parse', '--verify', '-q', 'HEAD'], { allowExitCodes: [1] })).exitCode === 0;
    const parts: string[] = [];
    if (amend && hasHead) {
      const hasParent = (await this.git.probe(['rev-parse', '--verify', '-q', 'HEAD~1'], { allowExitCodes: [1] })).exitCode === 0;
      parts.push(await this.git.read(['diff', '-M', hasParent ? 'HEAD~1' : EMPTY_TREE, 'HEAD', '--']));
    }
    const tracked = changes.filter((change) => !change.untracked);
    if (tracked.length > 0) {
      const paths = tracked.flatMap((change) => (change.oldPath ? [change.path, change.oldPath] : [change.path]));
      parts.push(await this.git.read(['diff', '-M', hasHead ? 'HEAD' : EMPTY_TREE, '--', ...paths]));
    }
    for (const change of changes.filter((candidate) => candidate.untracked)) {
      // Exits with 1 when the files differ, which they always do here.
      const result = await this.git.probe(['diff', '--no-index', '--', '/dev/null', change.path], { allowExitCodes: [1] });
      parts.push(result.stdout);
    }
    return parts.filter(Boolean).join('\n');
  }

  /** Message of the last commit, for Amend. */
  async lastMessage(): Promise<string> {
    const result = await this.git.probe(['log', '-1', '--format=%B'], { allowExitCodes: [128] });
    return result.exitCode === 0 ? result.stdout.trimEnd() : '';
  }
}

/** Parses `git status --porcelain -z`: `XY path\0`, renames add `origPath\0`. */
export function parseStatus(stdout: string): WorkingChange[] {
  const tokens = stdout.split('\0');
  const changes: WorkingChange[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.length < 4) continue;
    const index = token[0];
    const worktree = token[1];
    const path = token.slice(3);
    const renamed = index === 'R' || index === 'C';
    const oldPath = renamed ? tokens[++i] : undefined;
    const untracked = index === '?';
    const conflicted = index === 'U' || worktree === 'U' || (index === worktree && (index === 'A' || index === 'D'));
    const code = worktree !== ' ' && !renamed ? worktree : index;
    changes.push({
      path,
      oldPath,
      status: untracked ? 'A' : conflicted ? 'U' : index === 'A' ? 'A' : (code as WorkingChange['status']),
      untracked,
      staged: worktree === ' ',
      added: index === 'A',
    });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}
