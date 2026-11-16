import { shortHash, type FileChange } from '../git/models';
import type { Repository } from '../git/repository';
import type { DiffEntry, DiffPresenter } from './ui/diffPresenter';

interface Touched {
  first: { hash: string; change: FileChange };
  last: { hash: string; change: FileChange };
}

/**
 * The combined effect of a commit selection: which files it touches and how to diff them.
 * A file is compared from just before the oldest selected commit that touches it
 * to the newest one, which is how IntelliJ shows multi-commit selections.
 */
export class SelectionChanges {
  constructor(
    private readonly repo: Repository,
    private readonly diffs: DiffPresenter,
  ) {}

  /** @param hashes newest first */
  async list(hashes: readonly string[]): Promise<FileChange[]> {
    if (hashes.length === 1) return this.repo.diff.ofCommit(hashes[0]);
    const touched = await this.collect(hashes);
    return [...touched.entries()]
      .map(([path, { first, last }]): FileChange => {
        const status = first.change.status === 'A' ? 'A' : last.change.status === 'D' ? 'D' : 'M';
        return { status, path, oldPath: first.change.oldPath };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async open(hashes: readonly string[], path: string): Promise<void> {
    const entry = (await this.entries(hashes)).find((candidate) => candidate.path === path);
    if (entry) await this.diffs.showFile(this.repo, entry, this.title(hashes));
  }

  async openAll(hashes: readonly string[]): Promise<void> {
    await this.diffs.showAll(this.repo, await this.entries(hashes), `Changes in ${this.title(hashes)}`);
  }

  private async entries(hashes: readonly string[]): Promise<DiffEntry[]> {
    const touched = await this.collect(hashes);
    return [...touched.entries()].map(([path, { first, last }]) => ({
      path,
      oldPath: first.change.oldPath,
      left: `${first.hash}^`,
      right: last.hash,
    }));
  }

  private async collect(hashes: readonly string[]): Promise<Map<string, Touched>> {
    const oldestFirst = [...hashes].reverse();
    const perCommit = await Promise.all(oldestFirst.map((hash) => this.repo.diff.ofCommit(hash)));
    const touched = new Map<string, Touched>();
    perCommit.forEach((changes, index) => {
      const hash = oldestFirst[index];
      for (const change of changes) {
        // Follow renames inside the selection so a file keeps one entry.
        const previous = change.oldPath ? touched.get(change.oldPath) : touched.get(change.path);
        if (change.oldPath) touched.delete(change.oldPath);
        touched.set(change.path, { first: previous?.first ?? { hash, change }, last: { hash, change } });
      }
    });
    return touched;
  }

  private title(hashes: readonly string[]): string {
    return hashes.length === 1 ? shortHash(hashes[0]) : `${shortHash(hashes[hashes.length - 1])}..${shortHash(hashes[0])}`;
  }
}
