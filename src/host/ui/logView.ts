import * as vscode from 'vscode';
import { SerialQueue } from '../../core/async';
import { GraphLayouter } from '../../git/graph/layout';
import type { Commit } from '../../git/models';
import type { Repository } from '../../git/repository';
import type { LogCommand, LogEvents, LogFilter, LogHostApi, LogInit, LogPage, LogRow, MenuItem, SelectionDetails } from '../../protocol/log';
import { serve, type Server } from '../../protocol/rpc';
import { MenuSession, runAction, type ActionEnvFactory } from '../actions/action';
import { branchActions } from '../actions/branchActions';
import { commitActions, type CommitSelection } from '../actions/commitActions';
import type { RepositoryManager } from '../repositoryManager';
import { SelectionChanges } from '../selectionChanges';
import { settings } from '../settings';
import type { DiffPresenter } from './diffPresenter';
import type { MessageEditor, MessageEditRequest } from './interaction';
import { webviewTransport, type Webviews } from './webview';

const MAX_REF_SUBMENUS = 5;

/** Commits handed to the webview so far, with the graph state needed to continue the list. */
class LogSession {
  private key = '';
  private layouter = new GraphLayouter();
  private readonly order = new Map<string, number>();
  private readonly commits = new Map<string, Commit>();

  get loaded(): number {
    return this.order.size;
  }

  reset(key: string): void {
    this.key = key;
    this.layouter = new GraphLayouter();
    this.order.clear();
    this.commits.clear();
  }

  continues(key: string, offset: number): boolean {
    return key === this.key && offset === this.loaded;
  }

  append(commits: Commit[], withGraph: boolean): LogRow[] {
    return commits.map((commit) => {
      this.order.set(commit.hash, this.order.size);
      this.commits.set(commit.hash, commit);
      return withGraph ? { ...commit, graph: this.layouter.next(commit.hash, commit.parents) } : commit;
    });
  }

  /** Known commits for the hashes, in log order (newest first). */
  select(hashes: readonly string[]): Commit[] {
    return hashes
      .filter((hash) => this.commits.has(hash))
      .sort((a, b) => this.order.get(a)! - this.order.get(b)!)
      .map((hash) => this.commits.get(hash)!);
  }
}

/** The Git tool window: branches, commit graph and commit details in one webview. */
export class LogView implements vscode.WebviewViewProvider, MessageEditor, LogHostApi {
  static readonly viewId = 'gitjet.log';

  private view?: vscode.WebviewView;
  private server?: Server<LogEvents>;
  private readonly session = new LogSession();
  /** Pages mutate the session's graph state, so they must not interleave. */
  private readonly pageLoads = new SerialQueue();
  private readonly menus = new MenuSession();
  private readonly prompts = new Map<number, (value: string | undefined) => void>();
  private nextPromptId = 1;
  private pendingFilter?: LogFilter;

  constructor(
    private readonly webviews: Webviews,
    private readonly repos: RepositoryManager,
    private readonly createEnv: ActionEnvFactory,
    private readonly diffs: DiffPresenter,
  ) {
    repos.onDidChangeRepository((repo) => repo === repos.active && this.refresh());
    repos.onDidChangeActive(() => this.refresh());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.server = serve<LogHostApi, LogEvents>(webviewTransport(view.webview), this, (method, error) =>
      console.error(`[gitjet] log.${method} failed`, error),
    );
    const mounted = this.webviews.mount(view.webview, 'log');
    view.onDidDispose(() => {
      mounted.dispose();
      this.view = undefined;
      this.server = undefined;
      this.cancelPrompts();
    });
  }

  refresh(): void {
    this.server?.emit('changed', null);
  }

  async show(): Promise<void> {
    await vscode.commands.executeCommand(`${LogView.viewId}.focus`);
  }

  /** Shows the log with the given filter applied. */
  async showFiltered(filter: LogFilter): Promise<void> {
    if (this.server) this.server.emit('filter', filter);
    else this.pendingFilter = filter;
    await this.show();
  }

  // MessageEditor

  editMessage(request: MessageEditRequest): Promise<string | undefined> | undefined {
    if (!this.view?.visible || !this.server) return undefined;
    const id = this.nextPromptId++;
    this.server.emit('prompt', { id, ...request });
    return new Promise((resolve) => this.prompts.set(id, resolve));
  }

  // LogHostApi

  async init(): Promise<LogInit> {
    const filter = this.pendingFilter;
    this.pendingFilter = undefined;
    this.cancelPrompts();
    const snapshot = (await this.repos.active?.snapshot()) ?? null;
    return { repositories: this.repos.choices, snapshot, pageSize: settings.pageSize(), filter };
  }

  loadCommits(filter: LogFilter, offset: number, limit: number): Promise<LogPage> {
    return this.pageLoads.run(() => this.loadPage(filter, offset, limit));
  }

  private async loadPage(filter: LogFilter, offset: number, limit: number): Promise<LogPage> {
    const repo = this.repo();
    const key = JSON.stringify([repo.root, filter]);
    // A page that does not continue the session (reload, new filter) is laid out from the top.
    const skip = this.session.continues(key, offset) ? offset : 0;
    if (skip === 0) this.session.reset(key);

    const commits = await repo.log.query({
      revisions: filter.revision ? [filter.revision] : undefined,
      text: filter.text,
      author: filter.author,
      skip,
      limit: offset - skip + limit,
    });
    const rows = this.session.append(commits, !filter.text && !filter.author);
    return { rows: rows.slice(offset - skip), hasMore: commits.length === offset - skip + limit };
  }

  async getDetails(hashes: string[]): Promise<SelectionDetails> {
    const repo = this.repo();
    const [commits, changes] = await Promise.all([
      repo.log.details(hashes.slice(0, 50)),
      new SelectionChanges(repo, this.diffs).list(hashes),
    ]);
    return { commits, changes };
  }

  getContainingBranches(hash: string): Promise<string[]> {
    return this.repo().log.containingBranches(hash);
  }

  openDiff(hashes: string[], path: string): Promise<void> {
    return new SelectionChanges(this.repo(), this.diffs).open(hashes, path);
  }

  openAllDiffs(hashes: string[]): Promise<void> {
    return new SelectionChanges(this.repo(), this.diffs).openAll(hashes);
  }

  async commitMenu(hashes: string[]): Promise<MenuItem[]> {
    const repo = this.repo();
    const [env, selection] = await Promise.all([this.createEnv(repo), this.selection(repo, hashes)]);
    this.menus.reset();
    const items = this.menus.build(commitActions, selection, env);

    // Like IntelliJ: branches and tags on the commit get their own submenus.
    if (selection.commits.length === 1) {
      const refs = env.snapshot.refs.filter((ref) => ref.hash === selection.commits[0].hash).slice(0, MAX_REF_SUBMENUS);
      refs.forEach((ref, index) => {
        if (index === 0) items.push({ label: '', separator: true });
        const kind = ref.kind === 'tag' ? 'Tag' : 'Branch';
        items.push({ label: `${kind} '${ref.name}'`, children: this.menus.build(branchActions, ref, env) });
      });
    }
    return items;
  }

  async branchMenu(refFullName: string): Promise<MenuItem[]> {
    const env = await this.createEnv(this.repo());
    const ref = env.snapshot.refs.find((candidate) => candidate.fullName === refFullName);
    this.menus.reset();
    return ref ? this.menus.build(branchActions, ref, env) : [];
  }

  invokeMenu(id: string): Promise<void> {
    return this.menus.invoke(id);
  }

  async commitAction(actionId: string, hashes: string[]): Promise<void> {
    const repo = this.repo();
    const [env, selection] = await Promise.all([this.createEnv(repo), this.selection(repo, hashes)]);
    await runAction(commitActions, actionId, selection, env);
  }

  async branchAction(actionId: string, refFullName: string): Promise<void> {
    const env = await this.createEnv(this.repo());
    const ref = env.snapshot.refs.find((candidate) => candidate.fullName === refFullName);
    if (ref) await runAction(branchActions, actionId, ref, env);
  }

  async command(command: LogCommand): Promise<void> {
    await vscode.commands.executeCommand(
      { fetch: 'gitjet.fetch', update: 'gitjet.updateProject', push: 'gitjet.push', newBranch: 'gitjet.newBranch' }[command],
    );
  }

  async selectRepository(root: string): Promise<void> {
    this.repos.selectByRoot(root);
  }

  async answerPrompt(id: number, value: string | null): Promise<void> {
    this.prompts.get(id)?.(value?.trim() || undefined);
    this.prompts.delete(id);
  }

  private repo(): Repository {
    const repo = this.repos.active;
    if (!repo) throw new Error('No git repository is open.');
    return repo;
  }

  private async selection(repo: Repository, hashes: string[]): Promise<CommitSelection> {
    let commits = this.session.select(hashes);
    if (commits.length !== hashes.length) commits = await repo.log.byHashes(hashes);
    // Checking the ends is enough for the menu; history edits validate the whole range again.
    const ends = commits.length > 0 ? [commits[0], commits[commits.length - 1]] : [];
    const ancestry = await Promise.all(ends.map((commit) => repo.refs.isAncestor(commit.hash, 'HEAD')));
    return { commits, inCurrentBranch: commits.length > 0 && ancestry.every(Boolean) };
  }

  private cancelPrompts(): void {
    for (const resolve of this.prompts.values()) resolve(undefined);
    this.prompts.clear();
  }
}
