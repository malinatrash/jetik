import { basename } from 'node:path';
import { SerialQueue } from '../core/async';
import { Emitter, type Event } from '../core/event';
import type { GitExecutor, GitResult, GitRunOptions } from './executor';
import type { RepoSnapshot } from './models';
import type { GitRunner } from './runner';
import { BranchService } from './services/branchService';
import { CommitService } from './services/commitService';
import { DiffService } from './services/diffService';
import { HistoryService } from './services/historyService';
import { LogService } from './services/logService';
import { RefService } from './services/refService';
import { RemoteService } from './services/remoteService';
import { StashService } from './services/stashService';
import { SequencerService } from './services/sequencerService';
import { WorkingTreeService } from './services/workingTreeService';

/** One git working tree. Owns command execution; domain operations live in the services. */
export class Repository implements GitRunner {
  readonly refs = new RefService(this);
  readonly log = new LogService(this, this.refs);
  readonly diff = new DiffService(this);
  readonly branches = new BranchService(this);
  readonly commits = new CommitService(this);
  readonly history = new HistoryService(this, this.refs);
  readonly remotes = new RemoteService(this, this.refs, this.log);
  readonly sequencer = new SequencerService(this);
  readonly stash = new StashService(this);
  readonly workingTree = new WorkingTreeService(this, this.sequencer);

  private readonly mutations = new SerialQueue();
  private readonly changed = new Emitter<void>();
  private gitDirPath?: Promise<string>;

  /** Fires after every mutation made through this object, and when `notifyChanged` is called. */
  readonly onDidChange: Event<void> = this.changed.event;

  constructor(
    readonly root: string,
    private readonly executor: GitExecutor,
  ) {}

  get name(): string {
    return basename(this.root);
  }

  async read(args: readonly string[], options?: GitRunOptions): Promise<string> {
    return (await this.executor.run(args, options)).stdout;
  }

  probe(args: readonly string[], options?: GitRunOptions): Promise<GitResult> {
    return this.executor.run(args, options);
  }

  write(args: readonly string[], options?: GitRunOptions): Promise<GitResult> {
    return this.mutations.run(async () => {
      try {
        return await this.executor.run(args, options);
      } finally {
        this.changed.fire();
      }
    });
  }

  gitDir(): Promise<string> {
    this.gitDirPath ??= this.read(['rev-parse', '--absolute-git-dir']).then((out) => out.trim());
    return this.gitDirPath;
  }

  async commonDir(): Promise<string> {
    return (await this.read(['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
  }

  /** External change (file watcher): tell listeners to re-read state. */
  notifyChanged(): void {
    this.changed.fire();
  }

  async snapshot(): Promise<RepoSnapshot> {
    const [head, refs, remotes, operation] = await Promise.all([
      this.refs.head(),
      this.refs.list(),
      this.refs.remotes(),
      this.sequencer.state(),
    ]);
    return { root: this.root, name: this.name, head, refs, remotes, operation };
  }

  dispose(): void {
    this.changed.dispose();
  }
}
