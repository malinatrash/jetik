import type { RepoSnapshot } from '../../src/git/models';
import type { LogEvents, LogFilter, LogHostApi, LogRow, MessagePrompt, RepositoryChoice, SelectionDetails } from '../../src/protocol/log';
import type { Client } from '../../src/protocol/rpc';
import { persisted } from '../shared/host';
import { Store } from '../shared/store';

export interface LogState {
  ready: boolean;
  snapshot: RepoSnapshot | null;
  repositories: RepositoryChoice[];
  pageSize: number;
  rows: LogRow[];
  hasMore: boolean;
  loading: boolean;
  filter: LogFilter;
  selected: ReadonlySet<string>;
  /** Row the selection range is anchored to and the row with keyboard focus. */
  anchor?: string;
  focus?: string;
  details?: SelectionDetails;
  containing?: string[];
  prompt?: MessagePrompt;
  error?: string;
}

/** State and behavior of the log view; components render it and call its methods. */
export class LogStore extends Store<LogState> {
  readonly host: LogHostApi;
  /** Bumped whenever the list is replaced, so late responses for an old list are dropped. */
  private generation = 0;
  private detailsTimer?: ReturnType<typeof setTimeout>;
  private index = new Map<string, number>();

  constructor(client: Client<LogHostApi, LogEvents>) {
    super({
      ready: false,
      snapshot: null,
      repositories: [],
      pageSize: 500,
      rows: [],
      hasMore: false,
      loading: false,
      filter: persisted.get<LogFilter>('filter', {}),
      selected: new Set(),
    });
    this.host = client.api;
    client.on('changed', () => void this.reload());
    client.on('filter', (filter) => this.setFilter(filter));
    client.on('prompt', (prompt) => this.set({ prompt }));
    void this.reload();
  }

  indexOf(hash: string | undefined): number {
    return hash === undefined ? -1 : (this.index.get(hash) ?? -1);
  }

  /** Selected hashes in log order (newest first). */
  selection(): string[] {
    const { rows, selected } = this.state;
    return selected.size === 0 ? [] : rows.filter((row) => selected.has(row.hash)).map((row) => row.hash);
  }

  /** Re-reads repository state and the commits shown so far, keeping selection and scroll. */
  async reload(): Promise<void> {
    const generation = ++this.generation;
    try {
      const init = await this.host.init();
      if (generation !== this.generation) return;
      const filter = init.filter ?? this.state.filter;
      this.set({ repositories: init.repositories, snapshot: init.snapshot, pageSize: init.pageSize, filter, prompt: undefined });
      if (!init.snapshot) {
        this.setRows([], false);
        this.set({ ready: true, loading: false });
        return;
      }
      await this.loadFirstPage(generation, Math.max(this.state.rows.length, init.pageSize));
    } catch (error) {
      this.fail(generation, error);
    }
  }

  async loadMore(): Promise<void> {
    const { loading, hasMore, rows, filter, pageSize } = this.state;
    if (loading || !hasMore) return;
    const generation = this.generation;
    this.set({ loading: true });
    try {
      const page = await this.host.loadCommits(filter, rows.length, pageSize);
      if (generation !== this.generation) return;
      this.setRows([...this.state.rows, ...page.rows], page.hasMore);
      this.set({ loading: false });
    } catch (error) {
      this.fail(generation, error);
    }
  }

  setFilter(filter: LogFilter): void {
    persisted.set('filter', filter);
    this.set({ filter });
    const generation = ++this.generation;
    this.loadFirstPage(generation, this.state.pageSize).catch((error) => this.fail(generation, error));
  }

  patchFilter(patch: Partial<LogFilter>): void {
    this.setFilter({ ...this.state.filter, ...patch });
  }

  /** Filters by a ref; selecting the active one again clears the filter. */
  toggleRevision(revision: string, label: string): void {
    const active = this.state.filter.revision === revision;
    this.patchFilter({ revision: active ? undefined : revision, revisionLabel: active ? undefined : label });
  }

  click(hash: string, modifiers: { range: boolean; toggle: boolean }): void {
    const { selected, anchor } = this.state;
    if (modifiers.range && anchor !== undefined && this.indexOf(anchor) !== -1) {
      this.select(this.range(anchor, hash), anchor, hash);
    } else if (modifiers.toggle) {
      const next = new Set(selected);
      if (!next.delete(hash)) next.add(hash);
      this.select(next, hash, hash);
    } else {
      this.select(new Set([hash]), hash, hash);
    }
  }

  /** Right click keeps a multi-selection when it hits a selected row. */
  ensureSelected(hash: string): void {
    if (!this.state.selected.has(hash)) this.select(new Set([hash]), hash, hash);
  }

  moveFocus(delta: number, extend: boolean): void {
    const { rows, focus, anchor } = this.state;
    if (rows.length === 0) return;
    const from = this.indexOf(focus);
    const target = rows[Math.min(rows.length - 1, Math.max(0, from === -1 ? 0 : from + delta))].hash;
    if (extend && anchor !== undefined) this.select(this.range(anchor, target), anchor, target);
    else this.select(new Set([target]), target, target);
  }

  answerPrompt(value: string | null): void {
    const { prompt } = this.state;
    if (!prompt) return;
    this.set({ prompt: undefined });
    void this.host.answerPrompt(prompt.id, value);
  }

  dismissError(): void {
    this.set({ error: undefined });
  }

  private async loadFirstPage(generation: number, limit: number): Promise<void> {
    this.set({ loading: true, error: undefined });
    const page = await this.host.loadCommits(this.state.filter, 0, limit);
    if (generation !== this.generation) return;
    this.setRows(page.rows, page.hasMore);
    this.set({ ready: true, loading: false });
  }

  private setRows(rows: LogRow[], hasMore: boolean): void {
    this.index = new Map(rows.map((row, index) => [row.hash, index]));
    // Commits that disappeared (rewritten history, new filter) leave the selection.
    const selected = new Set([...this.state.selected].filter((hash) => this.index.has(hash)));
    const changed = selected.size !== this.state.selected.size;
    this.set({ rows, hasMore, selected });
    if (changed || rows.length === 0) this.scheduleDetails();
  }

  private range(from: string, to: string): Set<string> {
    const a = this.indexOf(from);
    const b = this.indexOf(to);
    return new Set(this.state.rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((row) => row.hash));
  }

  private select(selected: ReadonlySet<string>, anchor: string, focus: string): void {
    this.set({ selected, anchor, focus });
    this.scheduleDetails();
  }

  private scheduleDetails(): void {
    clearTimeout(this.detailsTimer);
    this.detailsTimer = setTimeout(() => void this.loadDetails(), 60);
  }

  private async loadDetails(): Promise<void> {
    const hashes = this.selection();
    if (hashes.length === 0) {
      this.set({ details: undefined, containing: undefined });
      return;
    }
    const isCurrent = () => this.selection().join() === hashes.join();
    try {
      const details = await this.host.getDetails(hashes);
      if (!isCurrent()) return;
      this.set({ details, containing: undefined });
      if (hashes.length === 1) {
        const containing = await this.host.getContainingBranches(hashes[0]);
        if (isCurrent()) this.set({ containing });
      }
    } catch {
      if (isCurrent()) this.set({ details: undefined, containing: undefined });
    }
  }

  private fail(generation: number, error: unknown): void {
    if (generation !== this.generation) return;
    this.set({ ready: true, loading: false, error: error instanceof Error ? error.message : String(error) });
  }
}
