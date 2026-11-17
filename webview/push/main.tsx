import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Commit, FileChange } from '../../src/git/models';
import type { PushEvents, PushHostApi, PushModel, PushTarget } from '../../src/protocol/push';
import { FileTree } from '../shared/FileTree';
import { Icon } from '../shared/Icon';
import { classes, formatDate } from '../shared/format';
import { connectHost } from '../shared/host';

const host = connectHost<PushHostApi, PushEvents>().api;

function App() {
  const [model, setModel] = useState<PushModel>();
  const [remote, setRemote] = useState('');
  const [target, setTarget] = useState('');
  const [outgoing, setOutgoing] = useState<PushTarget>();
  const [selected, setSelected] = useState<string>();
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [tags, setTags] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    host.init().then((initial) => {
      setModel(initial);
      setRemote(initial.remote);
      setTarget(initial.target);
      setOutgoing(initial);
    }, (failure: Error) => setError(failure.message));
  }, []);

  // Recompute the outgoing commits when the destination is edited.
  useEffect(() => {
    if (!model || !target.trim() || (remote === model.remote && target === model.target && outgoing === model)) return;
    let stale = false;
    const timer = setTimeout(() => {
      host.retarget(remote, target.trim()).then((next) => {
        if (stale) return;
        setOutgoing(next);
        setSelected(undefined);
      }, (failure: Error) => !stale && setError(failure.message));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [remote, target]);

  // Files of the selected commit, or of everything that will be pushed.
  const commits = outgoing?.commits ?? [];
  const shown = selected ? [selected] : commits.map((commit) => commit.hash);
  useEffect(() => {
    let stale = false;
    if (shown.length === 0) setChanges([]);
    else void host.getChanges(shown).then((next) => !stale && setChanges(next));
    return () => {
      stale = true;
    };
  }, [shown.join()]);

  const discarded = outgoing?.discarded ?? [];
  // The remote has commits the local branch dropped or rewrote: only a force push can update it.
  const diverged = discarded.length > 0;
  const canPush = outgoing !== undefined && target.trim() !== '' && (commits.length > 0 || outgoing.isNew || tags);
  const canForce = outgoing !== undefined && outgoing.forceAllowed && target.trim() !== '' && (canPush || diverged);
  const push = (force: boolean) => {
    if (force ? !canForce : !canPush) return;
    setError(undefined);
    host.push({ remote, target: target.trim(), force, tags }).catch((failure: Error) => setError(failure.message));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void host.cancel();
      // ⌘⇧Enter always force pushes; ⌘Enter does too when nothing but a force push can update the remote.
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) push(event.shiftKey || (diverged && commits.length === 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!model || !outgoing) return <div class="empty">{error ?? 'Loading…'}</div>;

  return (
    <div class="push-view">
      <div class="push-header">
        <Icon name="repo" />
        <b>{model.repoName}</b>
        <span class="ref ref-local">
          <Icon name="git-branch" />
          {model.sourceLabel}
        </span>
        <Icon name="arrow-right" />
        <select value={remote} onChange={(event) => setRemote((event.target as HTMLSelectElement).value)}>
          {model.remotes.map((name) => (
            <option value={name}>{name}</option>
          ))}
        </select>
        <span>:</span>
        <input class="target" value={target} spellcheck={false} onInput={(event) => setTarget((event.target as HTMLInputElement).value)} />
        {outgoing.isNew && <span class="chip">New</span>}
        <span class="spacer" />
        <span class="hint">
          {commits.length} {commits.length === 1 ? 'commit' : 'commits'}
          {diverged && `, ${discarded.length} to remove`}
        </span>
      </div>
      <div class="push-body">
        <div class="push-commits">
          {commits.length === 0 && !diverged && (
            <div class="empty">{outgoing.isNew ? 'No new commits; the branch will be created on the remote' : 'No commits to push'}</div>
          )}
          {commits.map((commit) => (
            <CommitRow commit={commit} selected={selected === commit.hash} onClick={() => setSelected(selected === commit.hash ? undefined : commit.hash)} />
          ))}
          {diverged && (
            <>
              <div class="push-section discarded">
                <Icon name="warning" />
                {outgoing.forceAllowed
                  ? `Not in ${model.sourceLabel}; Force Push removes ${discarded.length === 1 ? 'it' : 'them'} from ${remote}/${target.trim()}`
                  : `Not in ${model.sourceLabel}; '${target.trim()}' is protected, so they cannot be removed`}
              </div>
              {discarded.map((commit) => (
                <CommitRow
                  commit={commit}
                  discarded
                  selected={selected === commit.hash}
                  onClick={() => setSelected(selected === commit.hash ? undefined : commit.hash)}
                />
              ))}
            </>
          )}
        </div>
        <div class="push-files">
          <div class="pane-title">
            {changes.length} {changes.length === 1 ? 'file' : 'files'} {selected ? 'in the selected commit' : 'in all commits'}
          </div>
          <FileTree changes={changes} onOpen={(change) => void host.openDiff(shown, change.path)} />
        </div>
      </div>
      {error && <div class="error">{error}</div>}
      <div class="push-footer">
        <label>
          <input type="checkbox" checked={tags} onChange={(event) => setTags((event.target as HTMLInputElement).checked)} />
          Push tags
        </label>
        <span class="spacer" />
        <span class="hint">{diverged && commits.length === 0 ? '⌘/Ctrl+Enter to force push' : '⌘/Ctrl+Enter to push, ⇧ to force'}, Esc to cancel</span>
        <button class="secondary" onClick={() => void host.cancel()}>
          Cancel
        </button>
        <button
          class={classes(!diverged && 'secondary')}
          disabled={!canForce}
          title={outgoing.forceAllowed ? 'Push with --force-with-lease' : `'${target}' is a protected branch`}
          onClick={() => push(true)}
        >
          Force Push
        </button>
        <button
          class={classes(diverged && 'secondary')}
          disabled={!canPush}
          title={diverged ? `${remote}/${target.trim()} has commits that are not in ${model.sourceLabel}; a plain push will be rejected` : undefined}
          onClick={() => push(false)}
        >
          Push
        </button>
      </div>
    </div>
  );
}

function CommitRow(props: { commit: Commit; selected: boolean; discarded?: boolean; onClick(): void }) {
  const { commit } = props;
  return (
    <div class={classes('commit-row', props.discarded && 'discarded', props.selected && 'selected')} onClick={props.onClick}>
      <div class="commit-subject">
        <span class="dot" />
        <span class="subject-text" title={commit.subject}>
          {commit.subject}
        </span>
      </div>
      <div class="commit-author">{commit.author}</div>
      <div class="commit-date">{formatDate(commit.date)}</div>
    </div>
  );
}

render(<App />, document.getElementById('root')!);
