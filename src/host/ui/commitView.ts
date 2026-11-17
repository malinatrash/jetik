import { join } from 'node:path';
import * as vscode from 'vscode';
import type { WorkingChange } from '../../git/models';
import type { Repository } from '../../git/repository';
import type { CommitEvents, CommitHostApi, CommitModel, CommitRequestDto } from '../../protocol/commit';
import { serve, type Server } from '../../protocol/rpc';
import type { Workbench } from '../actions/action';
import { generateCommitMessage } from '../commitMessageGenerator';
import type { RepositoryManager } from '../repositoryManager';
import { settings } from '../settings';
import { NOTHING, WORKING_TREE, type DiffPresenter } from './diffPresenter';
import type { Interaction } from './interaction';
import type { OperationRunner } from './operationRunner';
import { webviewTransport, type Webviews } from './webview';

/** The Commit tool window: local changes with checkboxes, message, Commit / Commit and Push. */
export class CommitView implements vscode.WebviewViewProvider, CommitHostApi {
  static readonly viewId = 'gitjet.commitView';

  private server?: Server<CommitEvents>;
  private changes: WorkingChange[] = [];
  private generation?: vscode.CancellationTokenSource;

  constructor(
    private readonly webviews: Webviews,
    private readonly repos: RepositoryManager,
    private readonly deps: { ui: Interaction; ops: OperationRunner; diffs: DiffPresenter; workbench: Workbench },
  ) {
    repos.onDidChangeWorkingTree(() => this.server?.emit('changed', null));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.server = serve<CommitHostApi, CommitEvents>(webviewTransport(view.webview), this, (method, error) =>
      console.error(`[gitjet] commit.${method} failed`, error),
    );
    const mounted = this.webviews.mount(view.webview, 'commit');
    view.onDidChangeVisibility(() => view.visible && this.server?.emit('changed', null));
    view.onDidDispose(() => {
      mounted.dispose();
      this.server = undefined;
    });
  }

  async show(): Promise<void> {
    await vscode.commands.executeCommand(`${CommitView.viewId}.focus`);
  }

  async init(): Promise<CommitModel> {
    const repo = this.repos.active;
    if (!repo) return { repoName: null, repositories: [], changes: [] };
    const [changes, head, operation] = await Promise.all([repo.workingTree.status(), repo.refs.head(), repo.sequencer.state()]);
    this.changes = changes;
    return {
      repoName: repo.name,
      root: repo.root,
      repositories: this.repos.choices,
      branch: head.branch ?? head.hash?.slice(0, 8),
      changes,
      operation,
      messagePrefix: settings.messagePrefix(head.branch),
    };
  }

  async openDiff(path: string): Promise<void> {
    const repo = this.repo();
    const change = this.changes.find((candidate) => candidate.path === path);
    if (!change) return;
    if (change.untracked || (change.added && !change.oldPath)) {
      await vscode.window.showTextDocument(vscode.Uri.file(join(repo.root, path)), { preview: true });
      return;
    }
    await this.deps.diffs.showFile(
      repo,
      { path, oldPath: change.oldPath, left: 'HEAD', right: change.status === 'D' ? NOTHING : WORKING_TREE },
      'Local Changes',
    );
  }

  async commit(request: CommitRequestDto): Promise<boolean> {
    const repo = this.repo();
    const changes = this.select(request.paths);
    const committed = await this.deps.ops.run(
      repo,
      'Committing',
      () => repo.workingTree.commit({ changes, message: request.message, amend: request.amend }),
      { success: request.amend ? 'Commit amended' : `Committed ${changes.length} file(s)` },
    );
    if (committed && request.push) await this.deps.workbench.showPushDialog(repo);
    return committed;
  }

  async rollback(paths: string[]): Promise<void> {
    const repo = this.repo();
    const changes = this.select(paths).filter((change) => !change.untracked);
    if (changes.length === 0) return;
    const confirmed = await this.deps.ui.confirm(
      `Rollback changes in ${changes.length} file(s)?`,
      'Local modifications of these files will be lost.',
      'Rollback',
    );
    if (!confirmed) return;
    await this.deps.ops.run(repo, 'Rolling back', () => repo.workingTree.rollback(changes), {
      success: `Rolled back ${changes.length} file(s)`,
    });
  }

  async selectRepository(root: string): Promise<void> {
    this.repos.selectByRoot(root);
  }

  lastMessage(): Promise<string> {
    return this.repo().workingTree.lastMessage();
  }

  async generateMessage(paths: string[], amend: boolean): Promise<string> {
    const repo = this.repo();
    this.generation?.cancel();
    const generation = new vscode.CancellationTokenSource();
    this.generation = generation;
    try {
      const [diff, recentMessages, head] = await Promise.all([
        repo.workingTree.diffOf(this.select(paths), amend),
        // The commit being amended is rewritten, so it is not an example of the style.
        repo.log.recentMessages(20, amend ? 1 : 0),
        repo.refs.head(),
      ]);
      return await generateCommitMessage(
        { diff, recentMessages, branch: head.branch, prefix: settings.messagePrefix(head.branch) },
        generation.token,
      );
    } catch (error) {
      if (generation.token.isCancellationRequested) throw new Error('Generation stopped');
      throw error;
    } finally {
      generation.dispose();
      if (this.generation === generation) this.generation = undefined;
    }
  }

  async cancelGeneration(): Promise<void> {
    this.generation?.cancel();
  }

  private select(paths: readonly string[]): WorkingChange[] {
    const wanted = new Set(paths);
    return this.changes.filter((change) => wanted.has(change.path));
  }

  private repo(): Repository {
    const repo = this.repos.active;
    if (!repo) throw new Error('No git repository is open.');
    return repo;
  }
}
