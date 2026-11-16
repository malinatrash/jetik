import * as vscode from 'vscode';
import { GitError } from '../../git/executor';
import type { OperationKind } from '../../git/models';
import type { Repository } from '../../git/repository';
import { classifyRemoteFailure } from '../../git/services/remoteService';

export interface RunOptions {
  /** Status bar message on success. */
  success?: string;
  /** Chance to handle a git failure; return true when it was dealt with. */
  recover?(error: GitError): Promise<boolean>;
}

const TITLES: Record<OperationKind, string> = {
  rebase: 'Rebase',
  merge: 'Merge',
  'cherry-pick': 'Cherry-pick',
  revert: 'Revert',
};

/**
 * Runs git operations with progress and uniform failure handling: a stopped rebase/merge/
 * cherry-pick leads into the resolve → continue/abort flow, auth failures offer a terminal.
 */
export class OperationRunner {
  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly runInTerminal: (repo: Repository, command: string) => void,
  ) {}

  async run(repo: Repository, title: string, task: () => Promise<void>, options: RunOptions = {}): Promise<boolean> {
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Git: ${title}…` }, async () => {
        try {
          await task();
        } catch (error) {
          if (error instanceof GitError && (await options.recover?.(error))) return;
          throw error;
        }
      });
      if (options.success) vscode.window.setStatusBarMessage(`$(check) ${options.success}`, 5000);
      return true;
    } catch (error) {
      void this.report(repo, title, error);
      return false;
    }
  }

  async continue(repo: Repository): Promise<void> {
    const operation = await repo.sequencer.state();
    if (!operation) {
      void vscode.window.showInformationMessage('No rebase, merge or cherry-pick is in progress.');
      return;
    }
    const unresolved = await repo.sequencer.unresolvedFiles();
    if (unresolved.length > 0) {
      const open = 'Resolve Conflicts';
      const choice = await vscode.window.showWarningMessage(
        `${unresolved.length} file(s) still have conflicts. Resolve and stage them, then continue.`,
        open,
      );
      if (choice === open) await vscode.commands.executeCommand('workbench.view.scm');
      return;
    }
    await this.run(repo, `Continuing ${operation}`, () => repo.sequencer.continue(operation), {
      success: `${TITLES[operation]} finished`,
    });
  }

  async abort(repo: Repository): Promise<void> {
    const operation = await repo.sequencer.state();
    if (!operation) return;
    await this.run(repo, `Aborting ${operation}`, () => repo.sequencer.abort(operation), {
      success: `${TITLES[operation]} aborted`,
    });
  }

  private async report(repo: Repository, title: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const operation = await repo.sequencer.state().catch(() => undefined);
    if (operation) {
      await this.promptStopped(repo, operation);
      return;
    }

    const showOutput = 'Show Git Console';
    if (error instanceof GitError && classifyRemoteFailure(error.output) === 'auth') {
      const terminal = 'Run in Terminal';
      const choice = await vscode.window.showErrorMessage(
        `${title} failed: git could not authenticate without a prompt.`,
        terminal,
        showOutput,
      );
      if (choice === terminal) this.runInTerminal(repo, `git ${error.args.map(quoteArg).join(' ')}`);
      if (choice === showOutput) this.output.show();
      return;
    }
    const choice = await vscode.window.showErrorMessage(`${title} failed: ${message}`, showOutput);
    if (choice === showOutput) this.output.show();
  }

  private async promptStopped(repo: Repository, operation: OperationKind): Promise<void> {
    const unresolved = await repo.sequencer.unresolvedFiles().catch(() => []);
    const resolve = 'Resolve Conflicts';
    const proceed = 'Continue';
    const abort = 'Abort';
    const text =
      unresolved.length > 0
        ? `${TITLES[operation]} stopped: ${unresolved.length} file(s) have conflicts.`
        : `${TITLES[operation]} is paused and waits for you to continue.`;
    const buttons = unresolved.length > 0 ? [resolve, proceed, abort] : [proceed, abort];
    const choice = await vscode.window.showWarningMessage(text, ...buttons);
    if (choice === resolve) await vscode.commands.executeCommand('workbench.view.scm');
    if (choice === proceed) await this.continue(repo);
    if (choice === abort) await this.abort(repo);
  }
}

function quoteArg(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}
