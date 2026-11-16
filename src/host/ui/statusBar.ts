import * as vscode from 'vscode';
import type { RepositoryManager } from '../repositoryManager';

/** Branch widget (opens the Branches popup) and an indicator for a paused rebase/merge/cherry-pick. */
export class StatusBar implements vscode.Disposable {
  private readonly branch = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private readonly repository = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  private readonly operation = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly repos: RepositoryManager) {
    this.branch.command = 'gitjet.branches';
    this.branch.tooltip = 'Git Branches (GitJet)';
    this.repository.command = 'gitjet.selectRepository';
    this.repository.tooltip = 'Git Repository (GitJet): click to switch';
    this.operation.command = 'gitjet.continueOperation';
    this.operation.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.subscriptions = [
      repos.onDidChangeRepository((repo) => repo === repos.active && void this.update()),
      repos.onDidChangeActive(() => void this.update()),
    ];
    void this.update();
  }

  private async update(): Promise<void> {
    const repo = this.repos.active;
    if (!repo) {
      this.branch.hide();
      this.repository.hide();
      this.operation.hide();
      return;
    }
    const [head, refs, operation] = await Promise.all([repo.refs.head(), repo.refs.list(), repo.sequencer.state()]);
    const upstream = refs.find((ref) => ref.current)?.upstream;
    const sync = upstream && !upstream.gone ? [upstream.ahead && `↑${upstream.ahead}`, upstream.behind && `↓${upstream.behind}`].filter(Boolean).join(' ') : '';
    this.branch.text = `$(git-branch) ${head.branch ?? head.hash?.slice(0, 8) ?? 'no commits'}${sync ? ` ${sync}` : ''}`;
    this.branch.show();
    if (this.repos.repositories.length > 1) {
      this.repository.text = `$(repo) ${repo.name}`;
      this.repository.show();
    } else {
      this.repository.hide();
    }

    if (operation) {
      this.operation.text = `$(warning) ${operation} in progress`;
      this.operation.tooltip = 'Click to continue; use "GitJet: Abort…" to abort';
      this.operation.show();
    } else {
      this.operation.hide();
    }
  }

  dispose(): void {
    this.branch.dispose();
    this.repository.dispose();
    this.operation.dispose();
    this.subscriptions.forEach((d) => d.dispose());
  }
}
