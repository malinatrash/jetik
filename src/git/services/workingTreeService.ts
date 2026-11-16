import type { WorkingChange } from '../models';
import type { GitRunner } from '../runner';
import type { SequencerService } from './sequencerService';

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
