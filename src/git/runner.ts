import type { GitResult, GitRunOptions } from './executor';

/** What services need from a repository: read-only queries and serialized mutations. */
export interface GitRunner {
  /** Runs a read-only command and returns its stdout. */
  read(args: readonly string[], options?: GitRunOptions): Promise<string>;
  /** Runs a read-only command and returns the full result (use with `allowExitCodes`). */
  probe(args: readonly string[], options?: GitRunOptions): Promise<GitResult>;
  /** Runs a mutating command; mutations are queued and announce a repository change. */
  write(args: readonly string[], options?: GitRunOptions): Promise<GitResult>;
  /** Absolute path of the (per-worktree) git directory. */
  gitDir(): Promise<string>;
}
