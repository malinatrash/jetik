import { useMemo, useState } from 'preact/hooks';
import type { FileChange } from '../../src/git/models';
import { Icon } from './Icon';
import { classes } from './format';

interface Dir {
  name: string;
  path: string;
  dirs: Map<string, Dir>;
  files: FileChange[];
}

type Row = { depth: number; dir: Dir } | { depth: number; file: FileChange };

function buildTree(changes: FileChange[]): Dir {
  const root: Dir = { name: '', path: '', dirs: new Map(), files: [] };
  for (const change of changes) {
    const segments = change.path.split('/');
    segments.pop();
    let dir = root;
    for (const segment of segments) {
      let child = dir.dirs.get(segment);
      if (!child) {
        child = { name: segment, path: dir.path ? `${dir.path}/${segment}` : segment, dirs: new Map(), files: [] };
        dir.dirs.set(segment, child);
      }
      dir = child;
    }
    dir.files.push(change);
  }
  return root;
}

/** Folds chains of single-child directories into one row: `src/git/services`. */
function compact(dir: Dir, isRoot = true): Dir {
  let current = dir;
  while (!isRoot && current.files.length === 0 && current.dirs.size === 1) {
    const only = [...current.dirs.values()][0];
    current = { ...only, name: `${current.name}/${only.name}` };
  }
  return { ...current, dirs: new Map([...current.dirs].map(([name, child]) => [name, compact(child, false)])) };
}

function flatten(dir: Dir, depth: number, collapsed: ReadonlySet<string>, rows: Row[]): Row[] {
  const dirs = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const child of dirs) {
    rows.push({ depth, dir: child });
    if (!collapsed.has(child.path)) flatten(child, depth + 1, collapsed, rows);
  }
  for (const file of [...dir.files].sort((a, b) => a.path.localeCompare(b.path))) rows.push({ depth, file });
  return rows;
}

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Changed files as a directory tree, colored by status like the IDE's Changes view. */
export function FileTree({ changes, onOpen }: { changes: FileChange[]; onOpen(change: FileChange): void }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState<string>();
  const tree = useMemo(() => compact(buildTree(changes)), [changes]);
  const rows = flatten(tree, 0, collapsed, []);

  const toggle = (path: string) => {
    const next = new Set(collapsed);
    if (!next.delete(path)) next.add(path);
    setCollapsed(next);
  };

  return (
    <div class="file-tree">
      {rows.map((row) =>
        'dir' in row ? (
          <div class="tree-row" style={{ paddingLeft: 6 + row.depth * 14 }} onClick={() => toggle(row.dir.path)}>
            <Icon name={collapsed.has(row.dir.path) ? 'chevron-right' : 'chevron-down'} />
            <Icon name="folder" />
            <span class="tree-label">{row.dir.name}</span>
          </div>
        ) : (
          <div
            class={classes('tree-row', 'file', active === row.file.path && 'selected')}
            style={{ paddingLeft: 6 + row.depth * 14 + 16 }}
            title={row.file.oldPath ? `${row.file.oldPath} → ${row.file.path}` : row.file.path}
            onClick={() => {
              setActive(row.file.path);
              onOpen(row.file);
            }}
          >
            <span class={`tree-label status-${row.file.status}`}>{fileName(row.file.path)}</span>
            <span class="status-letter">{row.file.status}</span>
          </div>
        ),
      )}
    </div>
  );
}
