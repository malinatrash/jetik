import type { Commit, UpdateMethod } from '../models';
import type { GitRunner } from '../runner';
import type { LogService } from './logService';
import type { RefService } from './refService';

export interface PushOptions {
  remote: string;
  /** Revision to push: a branch name or a commit hash. */
  source: string;
  /** Branch name on the remote. */
  target: string;
  force: boolean;
  tags: boolean;
  setUpstream: boolean;
}

export interface Outgoing {
  commits: Commit[];
  /** The target branch does not exist on the remote yet. */
  isNew: boolean;
  /** Commits on the remote branch missing from `source` (dropped, reworded, rebased away), newest first.
   * A plain push is rejected while there are any; a force push removes them from the remote. */
  discarded: Commit[];
}

export class RemoteService {
  constructor(
    private readonly git: GitRunner,
    private readonly refs: RefService,
    private readonly log: LogService,
  ) {}

  async fetchAll(): Promise<void> {
    await this.git.write(['fetch', '--all', '--prune']);
  }

  /** Integrates the tracked branch into the current one. */
  async pull(method: UpdateMethod): Promise<void> {
    await this.git.write(['pull', ...pullFlags(method)]);
  }

  async pullFrom(remote: string, branch: string, method: UpdateMethod): Promise<void> {
    await this.git.write(['pull', ...pullFlags(method), remote, branch]);
  }

  /** Fast-forwards a branch that is not checked out to its remote counterpart. */
  async fastForward(localBranch: string, remote: string, remoteBranch: string): Promise<void> {
    await this.git.write(['fetch', remote, `${remoteBranch}:${localBranch}`]);
  }

  /** Commits a push of `source` to `remote/target` would send, newest first. */
  async outgoing(source: string, remote: string, target: string): Promise<Outgoing> {
    const remoteRef = `refs/remotes/${remote}/${target}`;
    if (await this.refs.resolve(remoteRef)) {
      const [commits, discarded] = await Promise.all([this.log.range(remoteRef, source), this.log.range(source, remoteRef)]);
      return { commits, isNew: false, discarded };
    }
    const stdout = await this.git.read(['rev-list', '--max-count=1000', source, '--not', `--remotes=${remote}`, '--']);
    return { commits: await this.log.byHashes(stdout.split('\n').filter(Boolean)), isNew: true, discarded: [] };
  }

  /** Pushes and returns what the remote said (hosting services print merge request links there). */
  async push(options: PushOptions): Promise<string> {
    const result = await this.git.write(pushArgs(options));
    return `${result.stderr}\n${result.stdout}`;
  }
}

export function pushArgs(options: PushOptions): string[] {
  const args = ['push'];
  if (options.force) args.push('--force-with-lease');
  if (options.tags) args.push('--tags');
  if (options.setUpstream) args.push('--set-upstream');
  args.push(options.remote, `${options.source}:refs/heads/${options.target}`);
  return args;
}

function pullFlags(method: UpdateMethod): string[] {
  return [method === 'rebase' ? '--rebase' : '--no-rebase', '--autostash'];
}

export interface ReviewLink {
  url: string;
  /** True when the link opens an existing merge/pull request rather than the creation form. */
  existing: boolean;
}

/** Finds the merge/pull request link GitLab, GitHub and Bitbucket print in push output. */
export function findReviewLink(pushOutput: string): ReviewLink | undefined {
  const url = /https?:\/\/\S*(?:merge_requests|pull-requests|\/pull\/|\/compare\/)\S*/.exec(pushOutput)?.[0];
  if (!url) return undefined;
  return { url, existing: !/merge_requests\/new|pull\/new|pull-requests\/new|\/compare\/|[?&]create/.test(url) };
}

export type RemoteFailure = 'rejected' | 'auth' | 'other';

export function classifyRemoteFailure(output: string): RemoteFailure {
  if (/\[rejected\]|non-fast-forward|fetch first|stale info/i.test(output)) return 'rejected';
  if (
    /terminal prompts disabled|could not read (Username|Password)|Authentication failed|Permission denied \(publickey|Host key verification failed/i.test(
      output,
    )
  ) {
    return 'auth';
  }
  return 'other';
}
