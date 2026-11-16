import * as vscode from 'vscode';
import type { Ref } from '../../git/models';
import type { MenuItem } from '../../protocol/log';
import { MenuSession, type ActionEnv } from '../actions/action';
import { branchActions } from '../actions/branchActions';

type Item = vscode.QuickPickItem & { run?: () => Promise<unknown> };

const separator = (label: string): Item => ({ label, kind: vscode.QuickPickItemKind.Separator });

function describe(ref: Ref): string | undefined {
  if (!ref.upstream) return undefined;
  if (ref.upstream.gone) return `${ref.upstream.name} (gone)`;
  const sync = [ref.upstream.ahead && `↑${ref.upstream.ahead}`, ref.upstream.behind && `↓${ref.upstream.behind}`].filter(Boolean);
  return [ref.upstream.name, ...sync].join(' ');
}

/** The Branches popup: pick a branch, then pick what to do with it. */
export async function showBranchPopup(env: ActionEnv, multipleRepositories = false): Promise<void> {
  const { refs } = env.snapshot;
  const branchItem = (ref: Ref): Item => ({
    label: `$(${ref.current ? 'star-full' : ref.kind === 'remote' ? 'cloud' : 'git-branch'}) ${ref.name}`,
    description: describe(ref),
    run: () => showBranchActions(ref, env),
  });

  const items: Item[] = [
    ...(multipleRepositories
      ? [{ label: `$(repo) Repository: ${env.snapshot.name}`, description: 'switch…', run: async () => vscode.commands.executeCommand('gitjet.selectRepository') }]
      : []),
    { label: '$(repo-pull) Update Project', run: async () => vscode.commands.executeCommand('gitjet.updateProject') },
    { label: '$(repo-push) Push…', run: async () => vscode.commands.executeCommand('gitjet.push') },
    { label: '$(add) New Branch…', run: async () => vscode.commands.executeCommand('gitjet.newBranch') },
    { label: '$(repo-fetch) Fetch', run: async () => vscode.commands.executeCommand('gitjet.fetch') },
    separator('Local'),
    ...refs.filter((ref) => ref.kind === 'local').sort((a, b) => Number(b.current) - Number(a.current)).map(branchItem),
    separator('Remote'),
    ...refs.filter((ref) => ref.kind === 'remote').map(branchItem),
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: `Git Branches in ${env.snapshot.name}`,
    placeHolder: 'Search for branches and actions',
    matchOnDescription: true,
  });
  await picked?.run?.();
}

async function showBranchActions(ref: Ref, env: ActionEnv): Promise<void> {
  const menus = new MenuSession();
  const items = menus.build(branchActions, ref, env).map(
    (item: MenuItem): Item =>
      item.separator
        ? separator('')
        : {
            label: item.label,
            description: item.disabled,
            run: item.disabled ? undefined : () => menus.invoke(item.id!),
          },
  );
  const picked = await vscode.window.showQuickPick(items, { title: ref.name, placeHolder: `Action for ${ref.name}` });
  await picked?.run?.();
}
