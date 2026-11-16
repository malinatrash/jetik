export type RefKind = 'local' | 'remote' | 'tag';

export interface Upstream {
  /** Short name, e.g. `origin/main`. */
  name: string;
  ahead: number;
  behind: number;
  gone: boolean;
}

export interface Ref {
  kind: RefKind;
  /** Short name: `main`, `origin/main`, `v1.0`. */
  name: string;
  /** Full name: `refs/heads/main`. */
  fullName: string;
  /** Commit the ref points at (tags are peeled). */
  hash: string;
  /** For remote branches: the remote part of the name. */
  remote?: string;
  upstream?: Upstream;
  current: boolean;
}

export interface Head {
  hash?: string;
  /** Undefined when HEAD is detached. */
  branch?: string;
}

export type OperationKind = 'rebase' | 'merge' | 'cherry-pick' | 'revert';

export interface RepoSnapshot {
  root: string;
  name: string;
  head: Head;
  refs: Ref[];
  remotes: string[];
  /** Sequencer operation that is stopped and waits for the user. */
  operation?: OperationKind;
}

export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  /** Author date, ms since epoch. */
  date: number;
  subject: string;
}

export interface CommitDetails extends Commit {
  /** Full message including the subject. */
  message: string;
  committer: string;
  committerDate: number;
}

export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U';

export interface FileChange {
  status: ChangeStatus;
  path: string;
  /** Set for renames and copies. */
  oldPath?: string;
}

/** A local (uncommitted) change, staged or not. */
export interface WorkingChange extends FileChange {
  /** Not yet under version control. */
  untracked: boolean;
  /** Fully staged: the working tree has nothing beyond the index for this path. */
  staged: boolean;
  /** Added to the index but absent from HEAD. */
  added: boolean;
}

export interface LogQuery {
  /** Revisions to walk from; all branches, remotes and tags when empty. */
  revisions?: string[];
  /** Matches the commit message, or resolves to a single commit when it looks like a hash. */
  text?: string;
  author?: string;
  skip: number;
  limit: number;
}

export type ResetMode = 'soft' | 'mixed' | 'hard' | 'keep';
export type UpdateMethod = 'merge' | 'rebase';

export const shortHash = (hash: string): string => hash.slice(0, 8);
