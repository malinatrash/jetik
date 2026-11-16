import * as vscode from 'vscode';
import { compactFileIconTheme, type FileIconTheme, type FileIcons, type LanguageContribution } from '../../protocol/fileIcons';

interface ActiveTheme {
  /** Folder of the extension that contributes the theme; icons and fonts are loaded from it. */
  root: vscode.Uri;
  file: vscode.Uri;
  theme: Omit<FileIconTheme, 'base'>;
}

/**
 * The file icon theme picked in `workbench.iconTheme`. VS Code has no API for it, so the theme
 * file is read from the extension that contributes it.
 */
export class FileIconThemes implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[];
  private active: ActiveTheme | 'generic' | null = null;
  private signature = '';
  private reloads = 0;

  /** Fires when webviews have to pick the icons up again. */
  readonly onDidChange = this.changed.event;

  constructor() {
    this.subscriptions = [
      this.changed,
      vscode.workspace.onDidChangeConfiguration((event) => event.affectsConfiguration('workbench.iconTheme') && void this.reload()),
      vscode.extensions.onDidChange(() => void this.reload()),
    ];
  }

  /** Reads the active theme. Await it once before the first webview is shown. */
  async reload(): Promise<void> {
    const reload = ++this.reloads;
    const active = await this.read();
    if (reload !== this.reloads) return;
    const signature = JSON.stringify(typeof active === 'object' && active ? [active.file.toString(), active.theme] : active);
    if (signature === this.signature) return;
    this.active = active;
    this.signature = signature;
    this.changed.fire();
  }

  /** Folders a webview has to be allowed to load icons from. */
  get resourceRoots(): vscode.Uri[] {
    return typeof this.active === 'object' && this.active ? [this.active.root] : [];
  }

  /** The icons in the form a webview draws them from, with URLs it can load. */
  for(webview: vscode.Webview): FileIcons {
    const active = this.active;
    if (active === null || active === 'generic') return active;
    return { ...active.theme, base: webview.asWebviewUri(active.file).toString() };
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
  }

  private async read(): Promise<ActiveTheme | 'generic' | null> {
    const id = vscode.workspace.getConfiguration('workbench').get<string | null>('iconTheme');
    if (!id) return null;
    try {
      for (const extension of vscode.extensions.all) {
        const themes = (extension.packageJSON?.contributes?.iconThemes ?? []) as { id?: string; path?: string }[];
        const path = themes.find((theme) => theme.id === id)?.path;
        if (!path) continue;
        const file = vscode.Uri.joinPath(extension.extensionUri, path);
        const document: unknown = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf8'));
        return { root: extension.extensionUri, file, theme: compactFileIconTheme(document, contributedLanguages()) };
      }
    } catch (error) {
      console.error(`[gitjet] cannot read the file icon theme ${id}`, error);
    }
    // Not found: in a remote window the theme may be installed where this extension host cannot see it.
    return 'generic';
  }
}

function contributedLanguages(): LanguageContribution[] {
  return vscode.extensions.all.flatMap((extension) => (extension.packageJSON?.contributes?.languages ?? []) as LanguageContribution[]);
}
