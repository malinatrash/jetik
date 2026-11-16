import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { Transport } from '../../protocol/rpc';
import type { FileIconThemes } from './fileIcons';

/** Loads the bundled webview entry points (`dist/webview/<entry>.js`) into webviews. */
export class Webviews {
  private readonly assets: vscode.Uri;

  constructor(
    extensionUri: vscode.Uri,
    private readonly icons: FileIconThemes,
  ) {
    this.assets = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  }

  /** Shows `entry` in the webview and reloads it when the file icon theme changes. Dispose with the webview. */
  mount(webview: vscode.Webview, entry: 'log' | 'push' | 'commit'): vscode.Disposable {
    const load = () => {
      webview.options = { enableScripts: true, localResourceRoots: [this.assets, ...this.icons.resourceRoots] };
      webview.html = this.html(webview, entry);
    };
    load();
    return this.icons.onDidChange(load);
  }

  private html(webview: vscode.Webview, entry: string): string {
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.assets, name));
    const nonce = randomBytes(16).toString('hex');
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    // Inert data block, read by webview/shared/FileIcon.tsx. `<` is escaped so the JSON cannot close the tag.
    const fileIcons = JSON.stringify(this.icons.for(webview)).replace(/</g, '\\u003c');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${asset('codicon.css')}">
  <link rel="stylesheet" href="${asset('styles.css')}">
</head>
<body>
  <div id="root"></div>
  <script type="application/json" id="file-icons">${fileIcons}</script>
  <script nonce="${nonce}" src="${asset(`${entry}.js`)}"></script>
</body>
</html>`;
  }
}

export function webviewTransport(webview: vscode.Webview): Transport {
  return {
    post: (message) => void webview.postMessage(message),
    listen: (handler) => void webview.onDidReceiveMessage(handler),
  };
}
