import type { RepositoryChoice } from '../../src/protocol/log';
import { Icon } from './Icon';

/** Repository switcher for multi-repository workspaces; renders nothing when there is only one. */
export function RepositorySelect({ repositories, active, onSelect }: { repositories: RepositoryChoice[]; active?: string; onSelect(root: string): void }) {
  if (repositories.length < 2) return null;
  return (
    <label class="repo-select" title="Git repository">
      <Icon name="repo" />
      <select value={active} onChange={(event) => onSelect((event.target as HTMLSelectElement).value)}>
        {repositories.map((repo) => (
          <option value={repo.root}>{repo.name}</option>
        ))}
      </select>
    </label>
  );
}
