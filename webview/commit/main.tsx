import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { WorkingChange } from '../../src/git/models';
import type { CommitEvents, CommitHostApi, CommitModel } from '../../src/protocol/commit';
import { Icon } from '../shared/Icon';
import { RepositorySelect } from '../shared/RepositorySelect';
import { classes } from '../shared/format';
import { connectHost, persisted } from '../shared/host';

const client = connectHost<CommitHostApi, CommitEvents>();
const host = client.api;

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const dirName = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

function Group(props: {
  title: string;
  changes: WorkingChange[];
  checked: ReadonlySet<string>;
  active?: string;
  onToggle(paths: string[], checked: boolean): void;
  onOpen(path: string): void;
}) {
  const [open, setOpen] = useState(true);
  const box = useRef<HTMLInputElement>(null);
  const count = props.changes.filter((change) => props.checked.has(change.path)).length;
  useEffect(() => {
    if (box.current) box.current.indeterminate = count > 0 && count < props.changes.length;
  }, [count, props.changes.length]);

  if (props.changes.length === 0) return null;
  return (
    <>
      <div class="tree-row section" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} />
        <input
          ref={box}
          type="checkbox"
          checked={count === props.changes.length}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => props.onToggle(props.changes.map((change) => change.path), (event.target as HTMLInputElement).checked)}
        />
        <span class="tree-label">{props.title}</span>
        <span class="sync">
          {props.changes.length} {props.changes.length === 1 ? 'file' : 'files'}
        </span>
      </div>
      {open &&
        props.changes.map((change) => (
          <div
            class={classes('tree-row', props.active === change.path && 'selected')}
            style={{ paddingLeft: 24 }}
            title={change.oldPath ? `${change.oldPath} → ${change.path}` : change.path}
            onClick={() => props.onOpen(change.path)}
          >
            <input
              type="checkbox"
              checked={props.checked.has(change.path)}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => props.onToggle([change.path], (event.target as HTMLInputElement).checked)}
            />
            <span class={`file-name status-${change.untracked ? 'untracked' : change.status}`}>{fileName(change.path)}</span>
            <span class="file-dir">{dirName(change.path)}</span>
            <span class="status-letter">{change.untracked ? '?' : change.status}</span>
          </div>
        ))}
    </>
  );
}

function App() {
  const [model, setModel] = useState<CommitModel>();
  // Tracked changes are included unless unchecked; unversioned files only when checked.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [included, setIncluded] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessageState] = useState(() => persisted.get('message', ''));
  const [amend, setAmend] = useState(false);
  const [active, setActive] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const setMessage = (value: string) => {
    setMessageState(value);
    persisted.set('message', value);
  };
  const reload = () => host.init().then(setModel, (failure: Error) => setError(failure.message));

  // Start the message with the branch's issue key, unless something else was already typed.
  const lastPrefix = useRef('');
  const prefix = model?.messagePrefix ?? '';
  useEffect(() => {
    if (!model) return;
    if (message === '' || message === lastPrefix.current) setMessage(prefix);
    lastPrefix.current = prefix;
  }, [prefix, model === undefined, message === '']);

  useEffect(() => {
    client.on('changed', () => void reload());
    void reload();
  }, []);

  if (!model) return <div class="empty">Loading…</div>;
  if (model.repoName === null) return <div class="empty">No git repository in this workspace</div>;

  const tracked = model.changes.filter((change) => !change.untracked);
  const untracked = model.changes.filter((change) => change.untracked);
  const checked = new Set([
    ...tracked.filter((change) => !excluded.has(change.path)).map((change) => change.path),
    ...untracked.filter((change) => included.has(change.path)).map((change) => change.path),
  ]);

  const toggle = (set: ReadonlySet<string>, update: (next: ReadonlySet<string>) => void, add: boolean) => (paths: string[]) => {
    const next = new Set(set);
    for (const path of paths) add ? next.add(path) : next.delete(path);
    update(next);
  };
  const open = (path: string) => {
    setActive(path);
    void host.openDiff(path);
  };

  const toggleAmend = async (value: boolean) => {
    setAmend(value);
    if (value && (!message.trim() || message === prefix)) setMessage(await host.lastMessage());
  };

  const commit = async (push: boolean) => {
    if (busy) return;
    if (!message.trim() || message === prefix) return setError('Specify a commit message');
    if (checked.size === 0 && !amend) return setError('Select files to commit');
    setError(undefined);
    setBusy(true);
    try {
      if (await host.commit({ paths: [...checked], message: message.trim(), amend, push })) {
        setMessage('');
        setAmend(false);
        setIncluded(new Set());
        setExcluded(new Set());
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void commit(event.altKey);
    }
  };

  const rollbackTargets = active && checked.size === 0 ? [active] : [...checked];
  return (
    <div class="commit-view">
      {model.repositories.length > 1 && (
        <div class="commit-toolbar">
          <RepositorySelect repositories={model.repositories} active={model.root} onSelect={(root) => void host.selectRepository(root)} />
        </div>
      )}
      <div class="commit-toolbar">
        <Icon name="git-branch" />
        <span class="tree-label">{model.branch ?? 'no commits yet'}</span>
        {model.operation && <span class="chip warning">{model.operation}</span>}
        <span class="icon-button" title="Rollback checked files" onClick={() => void host.rollback(rollbackTargets)}>
          <Icon name="discard" />
        </span>
        <span class="icon-button" title="Refresh" onClick={() => void reload()}>
          <Icon name="refresh" />
        </span>
      </div>
      <div class="tree">
        {model.changes.length === 0 && <div class="empty">No local changes</div>}
        <Group
          title="Changes"
          changes={tracked}
          checked={checked}
          active={active}
          onOpen={open}
          onToggle={(paths, on) => toggle(excluded, setExcluded, !on)(paths)}
        />
        <Group
          title="Unversioned Files"
          changes={untracked}
          checked={checked}
          active={active}
          onOpen={open}
          onToggle={(paths, on) => toggle(included, setIncluded, on)(paths)}
        />
      </div>
      <div class="commit-form">
        <label class="amend">
          <input type="checkbox" checked={amend} onChange={(event) => void toggleAmend((event.target as HTMLInputElement).checked)} />
          Amend
        </label>
        <textarea
          placeholder="Commit Message"
          spellcheck={false}
          value={message}
          onInput={(event) => setMessage((event.target as HTMLTextAreaElement).value)}
          onKeyDown={onKeyDown}
        />
        {error && (
          <div class="error" onClick={() => setError(undefined)}>
            {error}
          </div>
        )}
        <div class="commit-buttons">
          <button disabled={busy} title="⌘/Ctrl+Enter" onClick={() => void commit(false)}>
            {amend ? 'Amend Commit' : 'Commit'}
          </button>
          <button class="secondary" disabled={busy} title="⌥⌘/Ctrl+Alt+Enter" onClick={() => void commit(true)}>
            {amend ? 'Amend and Push…' : 'Commit and Push…'}
          </button>
        </div>
      </div>
    </div>
  );
}

render(<App />, document.getElementById('root')!);
