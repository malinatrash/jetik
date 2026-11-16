import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Ref, RepoSnapshot } from '../../src/git/models';
import type { LogRow } from '../../src/protocol/log';
import { contextMenu } from '../shared/ContextMenu';
import { Icon } from '../shared/Icon';
import { classes, formatDate } from '../shared/format';
import { GraphCell, graphWidth, ROW_HEIGHT } from './GraphCell';
import type { LogState, LogStore } from './logStore';

const OVERSCAN = 12;
const MAX_LABELS = 4;
const isMac = navigator.platform.toLowerCase().includes('mac');

function RefLabel({ refInfo }: { refInfo: Ref }) {
  const icon = refInfo.kind === 'tag' ? 'tag' : 'git-branch';
  return (
    <span class={classes('ref', `ref-${refInfo.kind}`, refInfo.current && 'ref-current')} title={refInfo.fullName}>
      <Icon name={icon} />
      {refInfo.name}
    </span>
  );
}

function Row({ row, refs, isHead, selected, focused }: { row: LogRow; refs: Ref[] | undefined; isHead: boolean; selected: boolean; focused: boolean }) {
  return (
    <div class={classes('commit-row', selected && 'selected', focused && 'focused', isHead && 'head')} data-hash={row.hash}>
      <div class="commit-subject">
        {row.graph ? <GraphCell graph={row.graph} isHead={isHead} /> : <span style={{ width: graphWidth(undefined) }} />}
        <span class="subject-text" title={row.subject}>
          {row.subject}
        </span>
        {isHead && <span class="ref ref-head">HEAD</span>}
        {refs?.slice(0, MAX_LABELS).map((ref) => <RefLabel refInfo={ref} />)}
        {refs && refs.length > MAX_LABELS && <span class="ref ref-more">+{refs.length - MAX_LABELS}</span>}
      </div>
      <div class="commit-author" title={row.email}>
        {row.author}
      </div>
      <div class="commit-date">{formatDate(row.date)}</div>
    </div>
  );
}

function refsByHash(snapshot: RepoSnapshot | null): Map<string, Ref[]> {
  const map = new Map<string, Ref[]>();
  const rank = { local: 0, remote: 1, tag: 2 };
  const refs = [...(snapshot?.refs ?? [])].sort((a, b) => Number(b.current) - Number(a.current) || rank[a.kind] - rank[b.kind]);
  for (const ref of refs) map.set(ref.hash, [...(map.get(ref.hash) ?? []), ref]);
  return map;
}

/** Virtualized commit table with IntelliJ-style selection and keyboard handling. */
export function CommitList({ store, state }: { store: LogStore; state: LogState }) {
  const { rows, selected, focus, snapshot } = state;
  const container = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const refs = useMemo(() => refsByHash(snapshot), [snapshot]);

  useLayoutEffect(() => {
    const element = container.current!;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);

  useEffect(() => {
    if (state.hasMore && !state.loading && end >= rows.length - 50) void store.loadMore();
  }, [end, rows.length, state.hasMore, state.loading]);

  // Keep the focused row visible while navigating with the keyboard.
  useEffect(() => {
    const index = store.indexOf(focus);
    const element = container.current;
    if (index === -1 || !element) return;
    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
  }, [focus]);

  const hashAt = (event: MouseEvent) => (event.target as HTMLElement).closest<HTMLElement>('.commit-row')?.dataset.hash;

  const onClick = (event: MouseEvent) => {
    const hash = hashAt(event);
    if (hash) store.click(hash, { range: event.shiftKey, toggle: isMac ? event.metaKey : event.ctrlKey });
  };

  const onContextMenu = (event: MouseEvent) => {
    const hash = hashAt(event);
    if (!hash) return;
    store.ensureSelected(hash);
    void contextMenu.show(event, store.host.commitMenu(store.selection()), (id) => void store.host.invokeMenu(id));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const page = Math.max(1, Math.floor(height / ROW_HEIGHT) - 1);
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page, Home: -rows.length, End: rows.length };
    const hashes = store.selection();
    if (event.key in moves) {
      store.moveFocus(moves[event.key], event.shiftKey);
    } else if (hashes.length === 0) {
      return;
    } else if (event.key === 'Enter') {
      void store.host.openAllDiffs(hashes);
    } else if (event.key === 'F2') {
      void store.host.commitAction('commit.reword', hashes);
    } else if (event.key === 'c' && (isMac ? event.metaKey : event.ctrlKey)) {
      void store.host.commitAction('commit.copyHash', hashes);
    } else {
      return;
    }
    event.preventDefault();
  };

  return (
    <div
      ref={container}
      class="commit-list"
      tabIndex={0}
      onScroll={(event) => setScrollTop((event.currentTarget as HTMLElement).scrollTop)}
      onClick={onClick}
      onDblClick={(event) => hashAt(event) && void store.host.openAllDiffs(store.selection())}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      <div style={{ height: rows.length * ROW_HEIGHT }}>
        <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
          {rows.slice(start, end).map((row) => (
            <Row
              key={row.hash}
              row={row}
              refs={refs.get(row.hash)}
              isHead={row.hash === snapshot?.head.hash}
              selected={selected.has(row.hash)}
              focused={row.hash === focus}
            />
          ))}
        </div>
      </div>
      {state.ready && rows.length === 0 && !state.loading && <div class="empty">No commits match the filters</div>}
    </div>
  );
}
