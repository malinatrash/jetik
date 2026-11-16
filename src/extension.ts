import * as vscode from 'vscode';
import type { GitLogger } from './git/executor';
import type { Repository } from './git/repository';
import type { ActionEnv, ActionEnvFactory, PushSource, Workbench } from './host/actions/action';
import { cleanupBranches, startAutoFetch, stashChanges, undoLastOperation, unstashChanges } from './host/commands';
import { RepositoryManager } from './host/repositoryManager';
import { settings } from './host/settings';
import { showBranchPopup } from './host/ui/branchPopup';
import { DIFF_SCHEME, DiffPresenter, RevisionContentProvider } from './host/ui/diffPresenter';
import { VsCodeInteraction } from './host/ui/interaction';
import { CommitView } from './host/ui/commitView';
import { LogView } from './host/ui/logView';
import { OperationRunner } from './host/ui/operationRunner';
import { PushDialog } from './host/ui/pushDialog';
import { StatusBar } from './host/ui/statusBar';

/** Composition root: builds the object graph and binds commands to it. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('GitJet');
  const logger: GitLogger = {
    command: (cwd, args) => output.appendLine(`[${new Date().toLocaleTimeString()}] ${cwd}> git ${args.join(' ')}`),
    result: (result, ms) => {
      if (result.stderr.trim()) output.appendLine(result.stderr.trimEnd());
      if (result.exitCode !== 0) output.appendLine(`exit code ${result.exitCode} (${ms} ms)`);
    },
  };

  const repos = new RepositoryManager(logger, context.workspaceState);
  const ui = new VsCodeInteraction();
  const diffs = new DiffPresenter();

  const runInTerminal = (repo: Repository, command: string) => {
    const terminal = vscode.window.createTerminal({ name: `Git: ${repo.name}`, cwd: repo.root });
    terminal.show();
    terminal.sendText(command);
  };
  const ops = new OperationRunner(output, runInTerminal);

  const workbench: Workbench = {
    showPushDialog: (repo: Repository, source?: PushSource) => PushDialog.show(context.extensionUri, repo, source, { ui, ops, diffs }),
    filterLog: (filter) => void logView.showFiltered(filter),
    runInTerminal,
    updateMethod: settings.updateMethod,
  };
  const createEnv: ActionEnvFactory = async (repo): Promise<ActionEnv> => ({
    repo,
    snapshot: await repo.snapshot(),
    ui,
    ops,
    diffs,
    workbench,
  });

  const logView = new LogView(context.extensionUri, repos, createEnv, diffs);
  ui.messageEditor = logView;
  const commitView = new CommitView(context.extensionUri, repos, { ui, ops, diffs, workbench });

  /** Wraps a command so it runs against the active repository, or explains why it cannot. */
  const withRepo = (handler: (repo: Repository) => unknown) => async () => {
    const repo = repos.active;
    if (!repo) {
      void vscode.window.showWarningMessage('GitJet: no git repository found in this workspace.');
      return;
    }
    await handler(repo);
  };

  const commands: Record<string, () => unknown> = {
    'gitjet.showLog': () => logView.show(),
    'gitjet.refresh': () => logView.refresh(),
    'gitjet.showCommit': () => commitView.show(),
    'gitjet.showOutput': () => output.show(),
    'gitjet.selectRepository': () => repos.pickActive(),
    'gitjet.push': withRepo((repo) => workbench.showPushDialog(repo)),
    'gitjet.branches': withRepo(async (repo) => showBranchPopup(await createEnv(repo), repos.repositories.length > 1)),
    'gitjet.undoLastOperation': withRepo((repo) => undoLastOperation(repo, { ui, ops })),
    'gitjet.cleanupBranches': withRepo((repo) => cleanupBranches(repo, { ui, ops })),
    'gitjet.stash': withRepo((repo) => stashChanges(repo, { ui, ops })),
    'gitjet.unstash': withRepo((repo) => unstashChanges(repo, { ui, ops })),
    'gitjet.continueOperation': withRepo((repo) => ops.continue(repo)),
    'gitjet.abortOperation': withRepo((repo) => ops.abort(repo)),
    'gitjet.fetch': withRepo((repo) => ops.run(repo, 'Fetching', () => repo.remotes.fetchAll(), { success: 'Fetch finished' })),
    'gitjet.updateProject': withRepo(async (repo) => {
      const { head, refs } = await repo.snapshot();
      const upstream = refs.find((ref) => ref.current)?.upstream;
      if (!upstream || upstream.gone) {
        void vscode.window.showWarningMessage(
          head.branch ? `Cannot update: ${head.branch} has no tracked branch.` : 'Cannot update: HEAD is detached.',
        );
        return;
      }
      await ops.run(repo, 'Updating project', () => repo.remotes.pull(settings.updateMethod()), {
        success: 'Project updated',
      });
    }),
    'gitjet.newBranch': withRepo(async (repo) => {
      const { refs } = await repo.snapshot();
      const existing = refs.filter((ref) => ref.kind === 'local').map((ref) => ref.name);
      const answer = await ui.branchName('New Branch', existing);
      if (!answer) return;
      await ops.run(repo, `Creating ${answer.name}`, () => repo.branches.create(answer.name, 'HEAD', answer.checkout), {
        success: `Created branch ${answer.name}`,
      });
    }),
  };

  context.subscriptions.push(
    output,
    repos,
    new StatusBar(repos),
    startAutoFetch(repos),
    vscode.window.registerWebviewViewProvider(LogView.viewId, logView, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerWebviewViewProvider(CommitView.viewId, commitView, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, new RevisionContentProvider((root) => repos.byRoot(root))),
    ...Object.entries(commands).map(([id, handler]) => vscode.commands.registerCommand(id, handler)),
  );

  await repos.discover();
}

export function deactivate(): void {}
