import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { debounce } from '../core/async';
import { GitExecutor, type GitLogger } from '../git/executor';
import { Repository } from '../git/repository';
import { settings } from './settings';

const ACTIVE_KEY = 'gitjet.activeRepository';
const SKIPPED_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'out']);
const WATCHED = '{HEAD,ORIG_HEAD,FETCH_HEAD,MERGE_HEAD,CHERRY_PICK_HEAD,REVERT_HEAD,packed-refs,refs/**,rebase-merge/**,rebase-apply/**}';

/** Discovers repositories in the workspace, tracks the active one and relays (debounced) changes. */
export class RepositoryManager implements vscode.Disposable {
  private readonly entries = new Map<string, { repo: Repository; disposables: vscode.Disposable[] }>();
  private activeRepo?: Repository;
  private touchWorkingTree: () => void = () => undefined;
  private readonly changed = new vscode.EventEmitter<Repository>();
  private readonly activeChanged = new vscode.EventEmitter<Repository | undefined>();
  private readonly workingTreeChanged = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[] = [];

  /** A repository's refs, HEAD or sequencer state changed. */
  readonly onDidChangeRepository = this.changed.event;
  readonly onDidChangeActive = this.activeChanged.event;
  /** Files or the index may have changed: local changes should be re-read. */
  readonly onDidChangeWorkingTree = this.workingTreeChanged.event;

  constructor(
    private readonly logger: GitLogger,
    /** Remembers the chosen repository per workspace. */
    private readonly memento: vscode.Memento,
  ) {
    this.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.discover()),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.followEditor(editor)),
      this.changed.event(() => this.workingTreeChanged.fire()),
      this.activeChanged.event(() => this.workingTreeChanged.fire()),
    );
    const touched = debounce(() => this.workingTreeChanged.fire(), 300);
    this.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(touched),
      vscode.workspace.onDidCreateFiles(touched),
      vscode.workspace.onDidDeleteFiles(touched),
      vscode.workspace.onDidRenameFiles(touched),
      vscode.window.onDidChangeWindowState((state) => state.focused && touched()),
      { dispose: () => touched.cancel() },
    );
    this.touchWorkingTree = touched;
  }

  get repositories(): Repository[] {
    return [...this.entries.values()].map((entry) => entry.repo);
  }

  get active(): Repository | undefined {
    return this.activeRepo;
  }

  /** Serializable list for the repository switchers in the views. */
  get choices(): { root: string; name: string }[] {
    return this.repositories.map((repo) => ({ root: repo.root, name: repo.name }));
  }

  selectByRoot(root: string): void {
    const repo = this.byRoot(root);
    if (repo) this.setActive(repo);
  }

  byRoot(root: string): Repository | undefined {
    return this.entries.get(root)?.repo;
  }

  async discover(): Promise<void> {
    const roots = new Set<string>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      for (const candidate of candidateDirs(folder.uri.fsPath)) {
        const result = await new GitExecutor(candidate, settings.gitPath)
          .run(['rev-parse', '--show-toplevel'], { allowExitCodes: [128] })
          .catch(() => undefined);
        if (result?.exitCode === 0) roots.add(result.stdout.trim());
      }
    }
    for (const [root, entry] of this.entries) {
      if (roots.has(root)) continue;
      entry.disposables.forEach((d) => d.dispose());
      entry.repo.dispose();
      this.entries.delete(root);
    }
    for (const root of roots) {
      if (!this.entries.has(root)) await this.open(root);
    }
    if (!this.activeRepo || !this.entries.has(this.activeRepo.root)) {
      const remembered = this.memento.get<string>(ACTIVE_KEY);
      this.activate((remembered && this.byRoot(remembered)) || this.repositories[0]);
    }
    void vscode.commands.executeCommand('setContext', 'gitjet.multipleRepositories', this.entries.size > 1);
  }

  /** Makes the repository the one all views and commands work with, and remembers the choice. */
  setActive(repo: Repository | undefined): void {
    if (repo) void this.memento.update(ACTIVE_KEY, repo.root);
    this.activate(repo);
  }

  private activate(repo: Repository | undefined): void {
    if (repo === this.activeRepo) return;
    this.activeRepo = repo;
    this.activeChanged.fire(repo);
  }

  async pickActive(): Promise<void> {
    const picked = await vscode.window.showQuickPick(
      this.repositories.map((repo) => ({
        label: `$(${repo === this.activeRepo ? 'check' : 'repo'}) ${repo.name}`,
        description: vscode.workspace.asRelativePath(repo.root, true),
        repo,
      })),
      { title: 'Git Repository', placeHolder: 'Repository for the log, commit, push and branch actions' },
    );
    if (picked) this.setActive(picked.repo);
  }

  private async open(root: string): Promise<void> {
    const repo = new Repository(root, new GitExecutor(root, settings.gitPath, this.logger));
    const notify = debounce(() => this.changed.fire(repo), 200);
    const disposables: vscode.Disposable[] = [repo.onDidChange(notify), { dispose: () => notify.cancel() }];

    const dirs = new Set([await repo.gitDir(), await repo.commonDir()]);
    for (const dir of dirs) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dir), WATCHED));
      const onFsEvent = () => repo.notifyChanged();
      disposables.push(watcher, watcher.onDidChange(onFsEvent), watcher.onDidCreate(onFsEvent), watcher.onDidDelete(onFsEvent));
    }
    const index = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(await repo.gitDir()), 'index'));
    disposables.push(index, index.onDidChange(() => this.touchWorkingTree()), index.onDidCreate(() => this.touchWorkingTree()));
    this.entries.set(root, { repo, disposables });
  }

  private followEditor(editor: vscode.TextEditor | undefined): void {
    if (!settings.followActiveEditor() || !editor || editor.document.uri.scheme !== 'file' || this.entries.size < 2) return;
    const path = editor.document.uri.fsPath;
    const owner = this.repositories
      .filter((repo) => path.startsWith(repo.root + '/') || path.startsWith(repo.root + '\\'))
      .sort((a, b) => b.root.length - a.root.length)[0];
    if (owner) this.activate(owner);
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.disposables.forEach((d) => d.dispose());
      entry.repo.dispose();
    }
    this.subscriptions.forEach((d) => d.dispose());
    this.changed.dispose();
    this.activeChanged.dispose();
    this.workingTreeChanged.dispose();
  }
}

/** The folder itself plus repositories nested up to two levels deep (multi-repo checkouts). */
function candidateDirs(folder: string, depth = 2): string[] {
  const dirs = [folder];
  const scan = (dir: string, level: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // Unreadable folder: nothing to add.
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue;
      const child = join(dir, entry.name);
      if (existsSync(join(child, '.git'))) dirs.push(child);
      else if (level < depth) scan(child, level + 1);
    }
  };
  scan(folder, 1);
  return dirs;
}
