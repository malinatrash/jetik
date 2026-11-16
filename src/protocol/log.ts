import type { GraphRow } from '../git/graph/layout';
import type { Commit, CommitDetails, FileChange, RepoSnapshot } from '../git/models';

export interface LogFilter {
  text?: string;
  author?: string;
  /** Revision expression to walk instead of all refs: a ref name or a range. */
  revision?: string;
  /** How the revision filter is shown in the toolbar. */
  revisionLabel?: string;
}

export interface LogRow extends Commit {
  /** Absent when the list is filtered and parent links would be meaningless. */
  graph?: GraphRow;
}

export interface LogPage {
  rows: LogRow[];
  hasMore: boolean;
}

export interface SelectionDetails {
  commits: CommitDetails[];
  /** Union of files touched by the selected commits. */
  changes: FileChange[];
}

export interface MenuItem {
  /** Token to pass to `invokeMenu`; absent for separators and submenu parents. */
  id?: string;
  label: string;
  /** When set, the item is disabled and this is the reason. */
  disabled?: string;
  separator?: boolean;
  children?: MenuItem[];
}

export interface MessagePrompt {
  id: number;
  title: string;
  initial: string;
  confirmLabel: string;
}

export interface RepositoryChoice {
  root: string;
  name: string;
}

export interface LogInit {
  /** Every repository in the workspace; the view offers a switcher when there are several. */
  repositories: RepositoryChoice[];
  snapshot: RepoSnapshot | null;
  pageSize: number;
  /** Filter requested by the host before the view was ready. */
  filter?: LogFilter;
}

export type LogCommand = 'fetch' | 'update' | 'push' | 'newBranch';

export interface LogHostApi {
  init(): Promise<LogInit>;
  loadCommits(filter: LogFilter, offset: number, limit: number): Promise<LogPage>;
  getDetails(hashes: string[]): Promise<SelectionDetails>;
  getContainingBranches(hash: string): Promise<string[]>;
  openDiff(hashes: string[], path: string): Promise<void>;
  openAllDiffs(hashes: string[]): Promise<void>;
  commitMenu(hashes: string[]): Promise<MenuItem[]>;
  branchMenu(refFullName: string): Promise<MenuItem[]>;
  invokeMenu(id: string): Promise<void>;
  /** Runs a commit action by id (keyboard shortcuts). */
  commitAction(actionId: string, hashes: string[]): Promise<void>;
  /** Runs a branch action by id (double click). */
  branchAction(actionId: string, refFullName: string): Promise<void>;
  command(command: LogCommand): Promise<void>;
  selectRepository(root: string): Promise<void>;
  answerPrompt(id: number, value: string | null): Promise<void>;
}

export interface LogEvents {
  /** Repository state changed; reload everything. */
  changed: null;
  filter: LogFilter;
  prompt: MessagePrompt;
}
