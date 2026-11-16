import type { OperationKind, WorkingChange } from '../git/models';
import type { RepositoryChoice } from './log';

export interface CommitModel {
  /** Null when no repository is open. */
  repoName: string | null;
  /** Root of the active repository. */
  root?: string;
  repositories: RepositoryChoice[];
  branch?: string;
  changes: WorkingChange[];
  /** Suggested start of the commit message (issue key from the branch name). */
  messagePrefix?: string;
  operation?: OperationKind;
}

export interface CommitRequestDto {
  paths: string[];
  message: string;
  amend: boolean;
  /** Open the push dialog after a successful commit. */
  push: boolean;
}

export interface CommitHostApi {
  init(): Promise<CommitModel>;
  openDiff(path: string): Promise<void>;
  /** Resolves to true when the commit was created. */
  commit(request: CommitRequestDto): Promise<boolean>;
  rollback(paths: string[]): Promise<void>;
  lastMessage(): Promise<string>;
  selectRepository(root: string): Promise<void>;
}

export interface CommitEvents {
  changed: null;
}
