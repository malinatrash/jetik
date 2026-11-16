import type { GitRunner } from '../runner';

export interface StashEntry {
  /** `stash@{0}` */
  ref: string;
  message: string;
  date: number;
}

export class StashService {
  constructor(private readonly git: GitRunner) {}

  async list(): Promise<StashEntry[]> {
    const stdout = await this.git.read(['stash', 'list', '--format=%gd%x1f%gs%x1f%ct']);
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [ref, message, date] = line.split('\x1f');
        return { ref, message, date: Number(date) * 1000 };
      });
  }

  /** Stashes all local changes including unversioned files; resolves to false when there was nothing to stash. */
  async push(message?: string): Promise<boolean> {
    const result = await this.git.write(['stash', 'push', '--include-untracked', ...(message ? ['-m', message] : [])]);
    return !/No local changes to save/i.test(result.stdout + result.stderr);
  }

  async pop(ref = 'stash@{0}'): Promise<void> {
    await this.git.write(['stash', 'pop', ref]);
  }

  async apply(ref: string): Promise<void> {
    await this.git.write(['stash', 'apply', ref]);
  }

  async drop(ref: string): Promise<void> {
    await this.git.write(['stash', 'drop', ref]);
  }
}
