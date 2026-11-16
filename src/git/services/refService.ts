import type { Head, Ref } from '../models';
import { parseRefs, REF_FORMAT } from '../parsers';
import type { GitRunner } from '../runner';

export class RefService {
  constructor(private readonly git: GitRunner) {}

  async list(): Promise<Ref[]> {
    const stdout = await this.git.read([
      'for-each-ref',
      `--format=${REF_FORMAT}`,
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ]);
    return parseRefs(stdout);
  }

  async head(): Promise<Head> {
    const [branch, hash] = await Promise.all([
      this.git.probe(['symbolic-ref', '-q', '--short', 'HEAD'], { allowExitCodes: [1, 128] }),
      this.git.probe(['rev-parse', '-q', '--verify', 'HEAD'], { allowExitCodes: [1, 128] }),
    ]);
    return {
      branch: branch.exitCode === 0 ? branch.stdout.trim() : undefined,
      hash: hash.exitCode === 0 ? hash.stdout.trim() : undefined,
    };
  }

  async remotes(): Promise<string[]> {
    return (await this.git.read(['remote'])).split('\n').filter(Boolean);
  }

  /** Resolves a revision to a commit hash, or undefined when it does not name a commit. */
  async resolve(revision: string): Promise<string | undefined> {
    const result = await this.git.probe(['rev-parse', '-q', '--verify', `${revision}^{commit}`], {
      allowExitCodes: [1, 128],
    });
    return result.exitCode === 0 ? result.stdout.trim() : undefined;
  }

  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    const result = await this.git.probe(['merge-base', '--is-ancestor', ancestor, descendant], {
      allowExitCodes: [1, 128],
    });
    return result.exitCode === 0;
  }
}

/** Splits `origin/feature/x` into remote and branch using the known remote names. */
export function splitRemoteBranch(name: string, remotes: readonly string[]): { remote: string; branch: string } {
  const remote =
    [...remotes].sort((a, b) => b.length - a.length).find((candidate) => name.startsWith(`${candidate}/`)) ??
    name.slice(0, Math.max(0, name.indexOf('/')));
  return { remote, branch: name.slice(remote.length + 1) };
}
