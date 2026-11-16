import type { ChangeStatus, Commit, CommitDetails, FileChange, Ref, Upstream } from './models';

const FIELD = '\x1f';

export const COMMIT_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%s'].join('%x1f');
export const DETAILS_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%s', '%cn', '%ct', '%B'].join('%x1f');
export const REF_FORMAT = [
  '%(refname)',
  '%(objectname)',
  '%(*objectname)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(HEAD)',
].join('%1f');

/** Parses `git log -z --format=COMMIT_FORMAT`. */
export function parseCommits(stdout: string): Commit[] {
  return stdout.split('\0').filter(Boolean).map(parseCommit);
}

function parseCommit(record: string): Commit {
  const [hash, parents, author, email, date, subject] = record.replace(/^\n/, '').split(FIELD);
  return {
    hash,
    parents: parents ? parents.split(' ') : [],
    author,
    email,
    date: Number(date) * 1000,
    subject: subject ?? '',
  };
}

/** Parses `git log -z --format=DETAILS_FORMAT`. */
export function parseCommitDetails(stdout: string): CommitDetails[] {
  return stdout
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const fields = record.replace(/^\n/, '').split(FIELD);
      return {
        ...parseCommit(record),
        committer: fields[6],
        committerDate: Number(fields[7]) * 1000,
        message: fields.slice(8).join(FIELD).trimEnd(),
      };
    });
}

/** Parses `git for-each-ref --format=REF_FORMAT refs/heads refs/remotes refs/tags`. */
export function parseRefs(stdout: string): Ref[] {
  const refs: Ref[] = [];
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const [fullName, objectName, peeled, upstream, track, head] = line.split(FIELD);
    const hash = peeled || objectName;
    if (fullName.startsWith('refs/heads/')) {
      refs.push({
        kind: 'local',
        name: fullName.slice('refs/heads/'.length),
        fullName,
        hash,
        upstream: upstream ? parseUpstream(upstream, track) : undefined,
        current: head === '*',
      });
    } else if (fullName.startsWith('refs/remotes/')) {
      const name = fullName.slice('refs/remotes/'.length);
      const slash = name.indexOf('/');
      // `origin/HEAD` is a symbolic pointer, not a branch; a bare `origin` has no branch part.
      if (slash === -1 || name.endsWith('/HEAD')) continue;
      refs.push({ kind: 'remote', name, fullName, hash, remote: name.slice(0, slash), current: false });
    } else if (fullName.startsWith('refs/tags/')) {
      refs.push({ kind: 'tag', name: fullName.slice('refs/tags/'.length), fullName, hash, current: false });
    }
  }
  return refs;
}

function parseUpstream(name: string, track: string): Upstream {
  return {
    name,
    ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
    gone: track.includes('gone'),
  };
}

/** Parses `--name-status -z` output: `M\0path\0` and `R100\0old\0new\0`. */
export function parseNameStatus(stdout: string): FileChange[] {
  const tokens = stdout.split('\0');
  const changes: FileChange[] = [];
  for (let i = 0; i < tokens.length; ) {
    const code = tokens[i++];
    if (!code) continue;
    const status = code[0] as ChangeStatus;
    if (status === 'R' || status === 'C') {
      const oldPath = tokens[i++];
      const path = tokens[i++];
      changes.push({ status, path, oldPath });
    } else {
      changes.push({ status, path: tokens[i++] });
    }
  }
  return changes;
}
