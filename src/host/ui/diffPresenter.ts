import { join } from 'node:path';
import * as vscode from 'vscode';
import type { Repository } from '../../git/repository';

export const DIFF_SCHEME = 'gitjet';
/** Pseudo-revision meaning "the file on disk". */
export const WORKING_TREE = ':working-tree';

/** Pseudo-revision that resolves to empty content (the file does not exist on that side). */
export const NOTHING = '0000000000000000000000000000000000000000';

export interface DiffEntry {
  path: string;
  oldPath?: string;
  left: string;
  right: string;
}

/** Serves file contents at a revision for the `gitjet:` scheme. */
export class RevisionContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly findRepository: (root: string) => Repository | undefined) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { root, revision, path } = JSON.parse(uri.query) as { root: string; revision: string; path: string };
    const repo = this.findRepository(root);
    return repo ? repo.diff.content(revision, path) : '';
  }
}

/** Opens VS Code diff editors for revisions of a repository. */
export class DiffPresenter {
  async showFile(repo: Repository, entry: DiffEntry, title: string): Promise<void> {
    await vscode.commands.executeCommand(
      'vscode.diff',
      this.uri(repo, entry.left, entry.oldPath ?? entry.path),
      this.uri(repo, entry.right, entry.path),
      `${entry.path.split('/').pop()} (${title})`,
      { preview: true },
    );
  }

  /** Opens all entries in one multi-file diff editor. */
  async showAll(repo: Repository, entries: DiffEntry[], title: string): Promise<void> {
    if (entries.length === 0) {
      void vscode.window.showInformationMessage('No differences.');
      return;
    }
    await vscode.commands.executeCommand(
      'vscode.changes',
      title,
      entries.map((entry) => [
        vscode.Uri.file(join(repo.root, entry.path)),
        this.uri(repo, entry.left, entry.oldPath ?? entry.path),
        this.uri(repo, entry.right, entry.path),
      ]),
    );
  }

  private uri(repo: Repository, revision: string, path: string): vscode.Uri {
    if (revision === WORKING_TREE) return vscode.Uri.file(join(repo.root, path));
    return vscode.Uri.from({
      scheme: DIFF_SCHEME,
      path: `/${path}`,
      query: JSON.stringify({ root: repo.root, revision, path }),
    });
  }
}
