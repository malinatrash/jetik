import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitRunner } from '../runner';
import { dropTodo, renderTodo, rewordTodo, shellQuote, squashTodo, type TodoEntry } from '../rebase/todo';
import type { RefService } from './refService';

export interface BranchOperation {
  /** Reflog subject, e.g. `rebase (finish): ...` or `commit (amend): ...`. */
  description: string;
  previous: string;
}

/** A merge-free stretch of the current branch that an edit has to replay. */
interface LinearRange {
  /** Commit the range sits on; undefined when it starts at a root commit. */
  base?: string;
  /** Oldest first, ends at HEAD. */
  commits: string[];
}

/**
 * History rewriting — squash, reword, drop — implemented as scripted interactive rebases,
 * the same way IntelliJ does it. Uncommitted changes are preserved via autostash.
 */
export class HistoryService {
  constructor(
    private readonly git: GitRunner,
    private readonly refs: RefService,
  ) {}

  /** Melds the commits into the oldest of them and gives the result a new message. */
  async squash(hashes: readonly string[], message: string): Promise<void> {
    const range = await this.rangeFrom(hashes);
    await this.rebase(range, (messageFile) => squashTodo(range.commits, new Set(hashes), messageFile), message);
  }

  async reword(hash: string, message: string): Promise<void> {
    if ((await this.refs.resolve('HEAD')) === hash) {
      // `--only` keeps staged changes out of the amended commit.
      await this.git.write(['commit', '--amend', '--only', '--allow-empty', '-F', '-'], { stdin: message });
      return;
    }
    const range = await this.rangeFrom([hash]);
    await this.rebase(range, (messageFile) => rewordTodo(range.commits, hash, messageFile), message);
  }

  async drop(hashes: readonly string[]): Promise<void> {
    const range = await this.rangeFrom(hashes);
    await this.rebase(range, () => dropTodo(range.commits, new Set(hashes)));
  }

  /** Commits all tracked local changes and melds them into an existing commit. */
  async fixup(hash: string): Promise<void> {
    const range = await this.rangeFrom([hash]);
    await this.git.write(['commit', '-a', `--fixup=${hash}`]);
    await this.git.write(['rebase', '-i', '--autosquash', '--autostash', range.base ?? '--root'], {
      env: { GIT_SEQUENCE_EDITOR: 'true' },
    });
  }

  /** The last thing that moved the branch, and where the branch was before it. */
  async lastOperation(branch: string): Promise<BranchOperation | undefined> {
    const ref = `refs/heads/${branch}`;
    const previous = await this.refs.resolve(`${ref}@{1}`);
    if (!previous) return undefined;
    const description = (await this.git.read(['reflog', 'show', '-1', '--format=%gs', ref])).trim();
    return { description, previous };
  }

  /**
   * Moves the current branch back to where it was before its last operation.
   * Undone commits leave their changes staged; anything else keeps local changes or refuses.
   */
  async undo(operation: BranchOperation): Promise<void> {
    const mode = /^commit\b/.test(operation.description) ? '--soft' : '--keep';
    await this.git.write(['reset', mode, operation.previous]);
  }

  /** True when the commit is already contained in the upstream of the current branch. */
  async isPushed(hash: string): Promise<boolean> {
    const upstream = await this.refs.resolve('@{upstream}');
    return upstream !== undefined && (await this.refs.isAncestor(hash, upstream));
  }

  private async rangeFrom(hashes: readonly string[]): Promise<LinearRange> {
    const distances = await Promise.all(
      hashes.map(async (hash) => {
        if (!(await this.refs.isAncestor(hash, 'HEAD'))) {
          throw new Error('The selected commits are not in the current branch.');
        }
        return Number(await this.git.read(['rev-list', '--count', `${hash}..HEAD`]));
      }),
    );
    const oldest = hashes[distances.indexOf(Math.max(...distances))];
    const base = await this.refs.resolve(`${oldest}^`);

    const stdout = await this.git.read([
      'rev-list',
      '--reverse',
      '--topo-order',
      '--parents',
      base ? `${base}..HEAD` : 'HEAD',
    ]);
    const lines = stdout.split('\n').filter(Boolean).map((line) => line.split(' '));
    if (lines.some((line) => line.length > 2)) {
      throw new Error('There are merge commits between the selected commits and HEAD; history cannot be edited across merges.');
    }
    const commits = lines.map((line) => line[0]);
    if (hashes.some((hash) => !commits.includes(hash))) {
      throw new Error('The selected commits are not in the current branch.');
    }
    return { base, commits };
  }

  private async rebase(
    range: LinearRange,
    buildTodo: (messageFile: string) => TodoEntry[],
    message?: string,
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'gitjet-'));
    const todoFile = join(dir, 'todo');
    const messageFile = join(dir, 'message');
    await writeFile(messageFile, (message ?? '').trimEnd() + '\n');
    await writeFile(todoFile, renderTodo(buildTodo(messageFile)));

    await this.git.write(['rebase', '-i', '--autostash', '--no-autosquash', '--keep-empty', range.base ?? '--root'], {
      // Git runs the "editor" through its shell with the todo path appended.
      env: { GIT_SEQUENCE_EDITOR: `cp ${shellQuote(todoFile)}` },
    });
    // On a stop (conflict) the directory must outlive this call: pending `exec` lines read the message file.
    await rm(dir, { recursive: true, force: true });
  }
}
