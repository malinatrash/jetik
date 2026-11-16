import { useMemo, useState } from 'preact/hooks';
import type { Ref, RepoSnapshot } from '../../src/git/models';
import { contextMenu } from '../shared/ContextMenu';
import { Icon } from '../shared/Icon';
import { classes } from '../shared/format';
import { persisted } from '../shared/host';
import type { LogStore } from './logStore';

interface Group {
  id: string;
  label: string;
  groups: Group[];
  refs: { ref: Ref; label: string }[];
}

/** Nests refs by the `/`-separated parts of their names: `feature/login` lives in folder `feature`. */
function group(id: string, label: string, refs: Ref[], nameOf: (ref: Ref) => string): Group {
  const root: Group = { id, label, groups: [], refs: [] };
  for (const ref of refs) {
    const parts = nameOf(ref).split('/');
    const leaf = parts.pop()!;
    let node = root;
    for (const part of parts) {
      let child = node.groups.find((candidate) => candidate.label === part);
      if (!child) {
        child = { id: `${node.id}/${part}`, label: part, groups: [], refs: [] };
        node.groups.push(child);
      }
      node = child;
    }
    node.refs.push({ ref, label: leaf });
  }
  return root;
}

function sections(snapshot: RepoSnapshot, query: string): Group[] {
  const matches = (ref: Ref) => ref.name.toLowerCase().includes(query);
  const of = (kind: Ref['kind']) => snapshot.refs.filter((ref) => ref.kind === kind && matches(ref));
  return [
    group('local', 'Local', of('local'), (ref) => ref.name),
    group('remote', 'Remote', of('remote'), (ref) => ref.name),
    group('tags', 'Tags', of('tag'), (ref) => ref.name),
  ].filter((section) => section.groups.length + section.refs.length > 0);
}

function syncStatus(ref: Ref): string {
  if (!ref.upstream) return '';
  if (ref.upstream.gone) return 'gone';
  return [ref.upstream.ahead && `↑${ref.upstream.ahead}`, ref.upstream.behind && `↓${ref.upstream.behind}`].filter(Boolean).join(' ');
}

/** The Branches pane: click filters the log, double click checks out, right click opens actions. */
export function BranchTree({ store, snapshot, activeRevision }: { store: LogStore; snapshot: RepoSnapshot; activeRevision?: string }) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(persisted.get<string[]>('collapsedBranches', ['tags'])));
  const tree = useMemo(() => sections(snapshot, query.trim().toLowerCase()), [snapshot, query]);
  const searching = query.trim() !== '';

  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (!next.delete(id)) next.add(id);
    setCollapsed(next);
    persisted.set('collapsedBranches', [...next]);
  };

  const renderRef = ({ ref, label }: { ref: Ref; label: string }, depth: number) => (
    <div
      class={classes('tree-row', activeRevision === ref.fullName && 'selected', ref.current && 'current')}
      style={{ paddingLeft: 6 + depth * 14 + 16 }}
      title={ref.upstream ? `${ref.name} → ${ref.upstream.name}` : ref.name}
      onClick={() => store.toggleRevision(ref.fullName, ref.name)}
      onDblClick={() => void store.host.branchAction('branch.checkout', ref.fullName)}
      onContextMenu={(event) => void contextMenu.show(event, store.host.branchMenu(ref.fullName), (id) => void store.host.invokeMenu(id))}
    >
      <Icon name={ref.current ? 'star-full' : ref.kind === 'tag' ? 'tag' : 'git-branch'} />
      <span class="tree-label">{label}</span>
      <span class="sync">{syncStatus(ref)}</span>
    </div>
  );

  const renderGroup = (node: Group, depth: number): preact.ComponentChildren => {
    const open = searching || !collapsed.has(node.id);
    return (
      <>
        <div class={classes('tree-row', depth === 0 && 'section')} style={{ paddingLeft: 6 + depth * 14 }} onClick={() => toggle(node.id)}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} />
          {depth > 0 && <Icon name="folder" />}
          <span class="tree-label">{node.label}</span>
        </div>
        {open && node.groups.map((child) => renderGroup(child, depth + 1))}
        {open && node.refs.map((entry) => renderRef(entry, depth + 1))}
      </>
    );
  };

  const head = snapshot.head;
  return (
    <div class="branches">
      <div class="search">
        <Icon name="search" />
        <input placeholder="Search branches" value={query} onInput={(event) => setQuery((event.target as HTMLInputElement).value)} />
      </div>
      <div class="tree">
        <div
          class={classes('tree-row', 'head-row', activeRevision === 'HEAD' && 'selected')}
          style={{ paddingLeft: 6 }}
          onClick={() => store.toggleRevision('HEAD', 'HEAD')}
        >
          <Icon name="target" />
          <span class="tree-label">HEAD ({head.branch ? 'Current Branch' : 'Detached'})</span>
        </div>
        {tree.map((section) => renderGroup(section, 0))}
      </div>
    </div>
  );
}
