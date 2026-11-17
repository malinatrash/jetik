import * as vscode from 'vscode';
import type { UpdateMethod } from '../git/models';

/** Typed access to user configuration. */
export const settings = {
  gitPath(): string {
    const configured = vscode.workspace.getConfiguration('git').get<string | string[] | null>('path');
    const path = Array.isArray(configured) ? configured[0] : configured;
    return path || 'git';
  },
  updateMethod(): UpdateMethod {
    return vscode.workspace.getConfiguration('gitjet').get<UpdateMethod>('updateMethod', 'merge');
  },
  pageSize(): number {
    return Math.max(50, vscode.workspace.getConfiguration('gitjet').get<number>('log.pageSize', 500));
  },
  /** Minutes between background fetches; 0 turns them off. */
  autoFetchMinutes(): number {
    return Math.max(0, vscode.workspace.getConfiguration('gitjet').get<number>('autoFetchMinutes', 10));
  },
  /** Commit message start derived from the branch name, e.g. `BTR-123: ` on `feature/BTR-123-login`. */
  messagePrefix(branch: string | undefined): string | undefined {
    const config = vscode.workspace.getConfiguration('gitjet');
    const pattern = config.get<string>('commit.issuePattern', '[A-Z][A-Z0-9]+-\\d+');
    if (!branch || !pattern) return undefined;
    try {
      const issue = new RegExp(pattern).exec(branch)?.[0];
      return issue ? config.get<string>('commit.messageTemplate', '{issue}: ').replace('{issue}', issue) : undefined;
    } catch {
      return undefined;
    }
  },
  /** Switch the active repository to the one containing the file in the active editor. */
  followActiveEditor(): boolean {
    return vscode.workspace.getConfiguration('gitjet').get<boolean>('followActiveEditor', false);
  },
  /** Part of the id, family or name of the language model that writes commit messages; empty picks the first one. */
  commitMessageModel(): string {
    return vscode.workspace.getConfiguration('gitjet').get<string>('commit.generate.model', '').trim();
  },
  /** Extra instructions for generated commit messages, e.g. a language or a convention. */
  commitMessageInstructions(): string {
    return vscode.workspace.getConfiguration('gitjet').get<string>('commit.generate.instructions', '');
  },
  protectedBranches(): string[] {
    return vscode.workspace.getConfiguration('gitjet').get<string[]>('protectedBranches', ['main', 'master']);
  },
};
