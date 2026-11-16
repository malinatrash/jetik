import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { LogEvents, LogHostApi } from '../../src/protocol/log';
import { ContextMenuHost } from '../shared/ContextMenu';
import { Icon } from '../shared/Icon';
import { RepositorySelect } from '../shared/RepositorySelect';
import { Resizer } from '../shared/Resizer';
import { connectHost, persisted } from '../shared/host';
import { useStore } from '../shared/store';
import { BranchTree } from './BranchTree';
import { CommitList } from './CommitList';
import { Details } from './Details';
import { MessageDialog } from './MessageDialog';
import { LogStore, type LogState } from './logStore';

const store = new LogStore(connectHost<LogHostApi, LogEvents>());

interface Layout {
  branches: number;
  details: number;
  files: number;
}

function FilterInput({ icon, placeholder, value, onChange }: { icon: string; placeholder: string; value: string; onChange(value: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  // Apply while typing, but not on every keystroke.
  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onChange(draft), 300);
    return () => clearTimeout(timer);
  }, [draft]);
  return (
    <div class="search">
      <Icon name={icon} />
      <input
        placeholder={placeholder}
        value={draft}
        onInput={(event) => setDraft((event.target as HTMLInputElement).value)}
        onKeyDown={(event) => event.key === 'Escape' && setDraft('')}
      />
    </div>
  );
}

function Toolbar({ state }: { state: LogState }) {
  const { filter } = state;
  return (
    <div class="toolbar">
      <RepositorySelect
        repositories={state.repositories}
        active={state.snapshot?.root}
        onSelect={(root) => {
          // Branch filters do not carry over to another repository.
          store.patchFilter({ revision: undefined, revisionLabel: undefined });
          void store.host.selectRepository(root);
        }}
      />
      <FilterInput icon="search" placeholder="Text or hash" value={filter.text ?? ''} onChange={(text) => store.patchFilter({ text: text || undefined })} />
      <FilterInput icon="person" placeholder="User" value={filter.author ?? ''} onChange={(author) => store.patchFilter({ author: author || undefined })} />
      {filter.revision && (
        <span class="chip" title={filter.revision}>
          Branch: {filter.revisionLabel ?? filter.revision}
          <span class="chip-close" onClick={() => store.patchFilter({ revision: undefined, revisionLabel: undefined })}>
            <Icon name="close" />
          </span>
        </span>
      )}
      <span class="spacer" />
      {state.loading && <span class="hint">Loading…</span>}
      {state.snapshot?.operation && <span class="chip warning">{state.snapshot.operation} in progress</span>}
    </div>
  );
}

function App() {
  const state = useStore(store);
  const [layout, setLayout] = useState<Layout>(() => persisted.get('layout', { branches: 220, details: 360, files: 180 }));
  const resize = (key: keyof Layout, delta: number, min: number) => {
    setLayout((current) => {
      const next = { ...current, [key]: Math.max(min, current[key] + delta) };
      persisted.set('layout', next);
      return next;
    });
  };

  if (!state.ready) return <div class="empty">Loading…</div>;
  if (!state.snapshot) return <div class="empty">No git repository in this workspace</div>;

  return (
    <div class="log-view">
      <div class="pane" style={{ width: layout.branches }}>
        <BranchTree store={store} snapshot={state.snapshot} activeRevision={state.filter.revision} />
      </div>
      <Resizer axis="x" onResize={(delta) => resize('branches', delta, 120)} />
      <div class="pane grow">
        <Toolbar state={state} />
        {state.error && (
          <div class="error" onClick={() => store.dismissError()}>
            {state.error}
          </div>
        )}
        <CommitList store={store} state={state} />
      </div>
      <Resizer axis="x" onResize={(delta) => resize('details', -delta, 200)} />
      <div class="pane" style={{ width: layout.details }}>
        <Details store={store} state={state} filesHeight={layout.files} onResize={(delta) => resize('files', delta, 60)} />
      </div>
      {state.prompt && <MessageDialog prompt={state.prompt} onAnswer={(value) => store.answerPrompt(value)} />}
      <ContextMenuHost />
    </div>
  );
}

render(<App />, document.getElementById('root')!);
