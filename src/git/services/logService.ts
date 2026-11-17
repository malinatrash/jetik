import type { Commit, CommitDetails, LogQuery } from '../models';
import { COMMIT_FORMAT, DETAILS_FORMAT, parseCommitDetails, parseCommits } from '../parsers';
import type { GitRunner } from '../runner';
import type { RefService } from './refService';

const HASH_LIKE = /^[0-9a-f]{7,40}$/i;

export class LogService {
  constructor(
    private readonly git: GitRunner,
    private readonly refs: RefService,
  ) {}

  async query(query: LogQuery): Promise<Commit[]> {
    const text = query.text?.trim();
    if (text && HASH_LIKE.test(text)) {
      const hash = await this.refs.resolve(text);
      if (hash) return query.skip === 0 ? this.byHashes([hash]) : [];
    }

    const args = [
      'log',
      '-z',
      `--format=${COMMIT_FORMAT}`,
      '--date-order',
      `--skip=${query.skip}`,
      `--max-count=${query.limit}`,
    ];
    if (text) args.push(`--grep=${text}`, '--regexp-ignore-case', '--fixed-strings');
    if (query.author) args.push(`--author=${query.author}`, '--regexp-ignore-case');

    if (query.revisions?.length) {
      args.push(...query.revisions);
    } else {
      args.push('--branches', '--remotes', '--tags');
      // HEAD does not resolve in a repository without commits.
      if (await this.refs.resolve('HEAD')) args.push('HEAD');
    }
    return parseCommits(await this.git.read([...args, '--']));
  }

  /** Commits reachable from `to` but not from `from`, newest first. */
  async range(from: string | undefined, to: string, limit = 1000): Promise<Commit[]> {
    const revisions = from ? [`${from}..${to}`] : [to];
    return parseCommits(
      await this.git.read(['log', '-z', `--format=${COMMIT_FORMAT}`, `--max-count=${limit}`, ...revisions, '--']),
    );
  }

  /** Full messages of the latest non-merge commits reachable from HEAD, newest first; empty before the first commit. */
  async recentMessages(limit: number, skip = 0): Promise<string[]> {
    const result = await this.git.probe(['log', '-z', '--no-merges', `--skip=${skip}`, `--max-count=${limit}`, '--format=%B', 'HEAD', '--'], {
      allowExitCodes: [128],
    });
    if (result.exitCode !== 0) return [];
    return result.stdout
      .split('\0')
      .map((message) => message.trim())
      .filter(Boolean);
  }

  async byHashes(hashes: readonly string[]): Promise<Commit[]> {
    if (hashes.length === 0) return [];
    return parseCommits(
      await this.git.read(['log', '-z', '--no-walk=unsorted', `--format=${COMMIT_FORMAT}`, ...hashes, '--']),
    );
  }

  async details(hashes: readonly string[]): Promise<CommitDetails[]> {
    if (hashes.length === 0) return [];
    return parseCommitDetails(
      await this.git.read(['log', '-z', '--no-walk=unsorted', `--format=${DETAILS_FORMAT}`, ...hashes, '--']),
    );
  }

  /** Short names of local and remote branches that contain the commit. */
  async containingBranches(hash: string): Promise<string[]> {
    const stdout = await this.git.read(['branch', '-a', '--contains', hash, '--format=%(refname:short)']);
    return stdout.split('\n').filter((name) => name && !name.endsWith('/HEAD') && !name.startsWith('('));
  }
}
