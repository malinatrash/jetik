import type { Commit, FileChange } from '../git/models';

export interface PushTarget {
  commits: Commit[];
  /** The branch will be created on the remote. */
  isNew: boolean;
  /** Remote commits a force push would remove; a plain push is rejected while there are any. */
  discarded: Commit[];
  forceAllowed: boolean;
}

export interface PushModel extends PushTarget {
  repoName: string;
  /** What is being pushed: a branch name or a short hash. */
  sourceLabel: string;
  remotes: string[];
  remote: string;
  target: string;
}

export interface PushRequest {
  remote: string;
  target: string;
  force: boolean;
  tags: boolean;
}

export interface PushHostApi {
  init(): Promise<PushModel>;
  retarget(remote: string, target: string): Promise<PushTarget>;
  getChanges(hashes: string[]): Promise<FileChange[]>;
  openDiff(hashes: string[], path: string): Promise<void>;
  push(request: PushRequest): Promise<void>;
  cancel(): Promise<void>;
}

export type PushEvents = Record<string, never>;
