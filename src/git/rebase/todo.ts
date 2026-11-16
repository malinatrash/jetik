export type TodoEntry =
  | { action: 'pick' | 'fixup' | 'squash'; hash: string }
  | { action: 'exec'; command: string }
  | { action: 'noop' };

export function renderTodo(entries: readonly TodoEntry[]): string {
  const lines = entries.map((entry) => {
    switch (entry.action) {
      case 'exec':
        return `exec ${entry.command}`;
      case 'noop':
        return 'noop';
      default:
        return `${entry.action} ${entry.hash}`;
    }
  });
  return lines.join('\n') + '\n';
}

/** Single-quotes a path for the POSIX shell git uses to run editors and `exec` lines (also on Windows). */
export function shellQuote(path: string): string {
  return `'${path.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`;
}

const amendMessage = (messageFile: string): TodoEntry => ({
  action: 'exec',
  command: `git commit --amend --only --allow-empty -F ${shellQuote(messageFile)}`,
});

/**
 * Melds `selected` into the oldest of them. Later selected commits are moved right after it,
 * so squashing non-adjacent commits works the way it does in IntelliJ.
 * @param commits linear range, oldest first
 */
export function squashTodo(commits: readonly string[], selected: ReadonlySet<string>, messageFile: string): TodoEntry[] {
  const todo: TodoEntry[] = [];
  const target = commits.findIndex((hash) => selected.has(hash));
  commits.forEach((hash, index) => {
    if (index === target) {
      todo.push({ action: 'pick', hash });
      for (const other of commits.slice(index + 1)) {
        if (selected.has(other)) todo.push({ action: 'fixup', hash: other });
      }
      todo.push(amendMessage(messageFile));
    } else if (!selected.has(hash)) {
      todo.push({ action: 'pick', hash });
    }
  });
  return todo;
}

export function rewordTodo(commits: readonly string[], target: string, messageFile: string): TodoEntry[] {
  return commits.flatMap((hash): TodoEntry[] =>
    hash === target ? [{ action: 'pick', hash }, amendMessage(messageFile)] : [{ action: 'pick', hash }],
  );
}

export function dropTodo(commits: readonly string[], dropped: ReadonlySet<string>): TodoEntry[] {
  const todo: TodoEntry[] = commits.filter((hash) => !dropped.has(hash)).map((hash) => ({ action: 'pick', hash }));
  return todo.length > 0 ? todo : [{ action: 'noop' }];
}
