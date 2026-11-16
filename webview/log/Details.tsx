import type { CommitDetails } from '../../src/git/models';
import { FileTree } from '../shared/FileTree';
import { Resizer } from '../shared/Resizer';
import { formatDate, shortHash } from '../shared/format';
import type { LogState, LogStore } from './logStore';

function CommitInfo({ commit, containing }: { commit: CommitDetails; containing?: string[] }) {
  const [subject, ...body] = commit.message.split('\n');
  return (
    <div class="commit-info">
      <div class="info-subject">{subject}</div>
      {body.join('\n').trim() && <pre class="info-body">{body.join('\n').trim()}</pre>}
      <div class="info-meta">
        <span class="info-hash" title={commit.hash}>
          {shortHash(commit.hash)}
        </span>{' '}
        {commit.author} &lt;{commit.email}&gt; on {formatDate(commit.date)}
        {commit.committer !== commit.author && <div>committed by {commit.committer} on {formatDate(commit.committerDate)}</div>}
      </div>
      {containing && containing.length > 0 && (
        <div class="info-meta" title={containing.join('\n')}>
          In {containing.length} {containing.length === 1 ? 'branch' : 'branches'}: {containing.slice(0, 6).join(', ')}
          {containing.length > 6 && ', …'}
        </div>
      )}
    </div>
  );
}

/** Right-hand pane: changed files of the selection on top, commit messages below. */
export function Details({ store, state, filesHeight, onResize }: { store: LogStore; state: LogState; filesHeight: number; onResize(delta: number): void }) {
  const { details } = state;
  if (!details) return <div class="details empty">Select commits to view changes</div>;
  const hashes = store.selection();
  return (
    <div class="details">
      <div class="details-files" style={{ height: filesHeight }}>
        <div class="pane-title">
          {details.changes.length} {details.changes.length === 1 ? 'file' : 'files'}
          {hashes.length > 1 && ` in ${hashes.length} commits`}
        </div>
        <FileTree changes={details.changes} onOpen={(change) => void store.host.openDiff(hashes, change.path)} />
      </div>
      <Resizer axis="y" onResize={onResize} />
      <div class="details-info">
        {details.commits.map((commit) => (
          <CommitInfo key={commit.hash} commit={commit} containing={details.commits.length === 1 ? state.containing : undefined} />
        ))}
      </div>
    </div>
  );
}
