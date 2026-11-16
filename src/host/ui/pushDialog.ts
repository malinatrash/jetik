import * as vscode from 'vscode';
import type { Repository } from '../../git/repository';
import { splitRemoteBranch } from '../../git/services/refService';
import { classifyRemoteFailure, findReviewLink } from '../../git/services/remoteService';
import type { PushEvents, PushHostApi, PushModel, PushRequest, PushTarget } from '../../protocol/push';
import type { FileChange } from '../../git/models';
import { serve } from '../../protocol/rpc';
import type { PushSource } from '../actions/action';
import { SelectionChanges } from '../selectionChanges';
import { settings } from '../settings';
import type { DiffPresenter } from './diffPresenter';
import type { Interaction } from './interaction';
import type { OperationRunner } from './operationRunner';
import { webviewTransport, type Webviews } from './webview';

/** The Push Commits dialog: preview of what a push will send, then the push itself. */
export class PushDialog implements PushHostApi {
  private static current?: vscode.WebviewPanel;

  static async show(
    webviews: Webviews,
    repo: Repository,
    source: PushSource | undefined,
    deps: { ui: Interaction; ops: OperationRunner; diffs: DiffPresenter },
  ): Promise<void> {
    const snapshot = await repo.snapshot();
    const branch = source?.branch ?? snapshot.head.branch;
    if (!branch) {
      void vscode.window.showWarningMessage('Cannot push: HEAD is detached. Check out a branch first.');
      return;
    }
    if (snapshot.remotes.length === 0) {
      void vscode.window.showWarningMessage('Cannot push: the repository has no remotes.');
      return;
    }
    const upstream = snapshot.refs.find((ref) => ref.kind === 'local' && ref.name === branch)?.upstream;
    const tracked = upstream && !upstream.gone ? splitRemoteBranch(upstream.name, snapshot.remotes) : undefined;
    const remote = tracked?.remote ?? (snapshot.remotes.includes('origin') ? 'origin' : snapshot.remotes[0]);

    PushDialog.current?.dispose();
    const panel = vscode.window.createWebviewPanel('gitjet.push', `Push Commits to ${repo.name}`, vscode.ViewColumn.Active, {
      retainContextWhenHidden: true,
    });
    PushDialog.current = panel;

    const dialog = new PushDialog(
      repo,
      source ?? { revision: branch, label: branch, branch },
      { remotes: snapshot.remotes, remote, target: tracked?.branch ?? branch, hasUpstream: upstream !== undefined },
      panel,
      deps,
    );
    serve<PushHostApi, PushEvents>(webviewTransport(panel.webview), dialog);
    const mounted = webviews.mount(panel.webview, 'push');
    panel.onDidDispose(() => {
      mounted.dispose();
      if (PushDialog.current === panel) PushDialog.current = undefined;
    });
  }

  private constructor(
    private readonly repo: Repository,
    private readonly source: PushSource,
    private readonly defaults: { remotes: string[]; remote: string; target: string; hasUpstream: boolean },
    private readonly panel: vscode.WebviewPanel,
    private readonly deps: { ui: Interaction; ops: OperationRunner; diffs: DiffPresenter },
  ) {}

  async init(): Promise<PushModel> {
    const { remotes, remote, target } = this.defaults;
    return {
      repoName: this.repo.name,
      sourceLabel: this.source.label,
      remotes,
      remote,
      target,
      ...(await this.retarget(remote, target)),
    };
  }

  async retarget(remote: string, target: string): Promise<PushTarget> {
    const outgoing = await this.repo.remotes.outgoing(this.source.revision, remote, target);
    return { ...outgoing, forceAllowed: !settings.protectedBranches().includes(target) };
  }

  getChanges(hashes: string[]): Promise<FileChange[]> {
    return new SelectionChanges(this.repo, this.deps.diffs).list(hashes);
  }

  openDiff(hashes: string[], path: string): Promise<void> {
    return new SelectionChanges(this.repo, this.deps.diffs).open(hashes, path);
  }

  async cancel(): Promise<void> {
    this.panel.dispose();
  }

  async push(request: PushRequest): Promise<void> {
    const { repo, source } = this;
    const { ui, ops } = this.deps;
    if (request.force && settings.protectedBranches().includes(request.target)) {
      throw new Error(`Force push to protected branch '${request.target}' is not allowed.`);
    }
    if (request.force) {
      const confirmed = await ui.confirm(
        `Force push ${source.label} to ${request.remote}/${request.target}?`,
        'Commits on the remote branch that you do not have locally will be overwritten.',
        'Force Push',
      );
      if (!confirmed) return;
    }
    this.panel.dispose();

    const options = {
      remote: request.remote,
      source: source.revision,
      target: request.target,
      force: request.force,
      tags: request.tags,
      // Track the target when the branch itself is pushed and tracks nothing yet.
      setUpstream: !this.defaults.hasUpstream && source.revision === source.branch,
    };
    let output = '';
    const pushed = await ops.run(
      repo,
      `Pushing ${source.label}`,
      async () => {
        output = await repo.remotes.push(options);
      },
      {
      success: `Pushed ${source.label} to ${request.remote}/${request.target}`,
      recover: async (error) => {
        if (request.force || classifyRemoteFailure(error.output) !== 'rejected') return false;
        const choice = await ui.choose(
          'Push Rejected',
          `${request.remote}/${request.target} has commits that you do not have locally. Update ${source.branch} and push again?`,
          'Rebase',
          'Merge',
        );
        if (!choice) return true;
        await repo.remotes.pullFrom(request.remote, request.target, choice === 'Rebase' ? 'rebase' : 'merge');
        output = await repo.remotes.push(options);
        return true;
      },
      },
    );

    const review = pushed ? findReviewLink(output) : undefined;
    if (review) {
      const open = review.existing ? 'Open Merge Request' : 'Create Merge Request';
      const choice = await vscode.window.showInformationMessage(`Pushed ${source.label} to ${request.remote}/${request.target}`, open);
      if (choice === open) await vscode.env.openExternal(vscode.Uri.parse(review.url));
    }
  }
}
