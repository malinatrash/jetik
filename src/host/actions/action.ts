import type { RepoSnapshot, UpdateMethod } from '../../git/models';
import type { Repository } from '../../git/repository';
import type { LogFilter, MenuItem } from '../../protocol/log';
import type { DiffPresenter } from '../ui/diffPresenter';
import type { Interaction } from '../ui/interaction';
import type { OperationRunner } from '../ui/operationRunner';

/** What is pushed by the push dialog. */
export interface PushSource {
  /** Branch name or commit hash. */
  revision: string;
  label: string;
  /** Local branch whose upstream decides the default target. */
  branch: string;
}

/** Editor-level capabilities actions may use without knowing who provides them. */
export interface Workbench {
  showPushDialog(repo: Repository, source?: PushSource): Promise<void>;
  filterLog(filter: LogFilter): void;
  runInTerminal(repo: Repository, command: string): void;
  updateMethod(): UpdateMethod;
}

export interface ActionEnv {
  repo: Repository;
  snapshot: RepoSnapshot;
  ui: Interaction;
  ops: OperationRunner;
  diffs: DiffPresenter;
  workbench: Workbench;
}

export type ActionEnvFactory = (repo: Repository) => Promise<ActionEnv>;

/**
 * A user-facing git operation on a target (a branch, a commit selection).
 * The same action objects back context menus, quick picks and keyboard shortcuts.
 */
export interface GitAction<T> {
  id: string;
  label(target: T, env: ActionEnv): string;
  /** Hidden unless this returns true (default: visible). */
  visible?(target: T, env: ActionEnv): boolean;
  /** Returns the reason the action is unavailable, if it is. */
  disabled?(target: T, env: ActionEnv): string | undefined;
  run(target: T, env: ActionEnv): Promise<void>;
}

/** Actions separated into visual groups. */
export type ActionGroups<T> = readonly (readonly GitAction<T>[])[];

/** Turns actions into serializable menu items and remembers what each item runs. */
export class MenuSession {
  private readonly handlers = new Map<string, () => Promise<void>>();
  private nextId = 1;

  reset(): void {
    this.handlers.clear();
  }

  build<T>(groups: ActionGroups<T>, target: T, env: ActionEnv): MenuItem[] {
    const items: MenuItem[] = [];
    for (const group of groups) {
      const visible = group.filter((action) => action.visible?.(target, env) ?? true);
      if (visible.length === 0) continue;
      if (items.length > 0) items.push({ label: '', separator: true });
      for (const action of visible) {
        const id = `${action.id}#${this.nextId++}`;
        this.handlers.set(id, () => action.run(target, env));
        items.push({ id, label: action.label(target, env), disabled: action.disabled?.(target, env) });
      }
    }
    return items;
  }

  async invoke(id: string): Promise<void> {
    await this.handlers.get(id)?.();
  }
}

/** Runs an action by id if it is currently applicable to the target. */
export async function runAction<T>(groups: ActionGroups<T>, id: string, target: T, env: ActionEnv): Promise<void> {
  const action = groups.flat().find((candidate) => candidate.id === id);
  if (!action || action.visible?.(target, env) === false || action.disabled?.(target, env)) return;
  await action.run(target, env);
}
