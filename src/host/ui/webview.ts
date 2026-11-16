import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { Transport } from '../../protocol/rpc';

export function webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')] };
}

/** HTML shell for a bundled webview entry point (`dist/webview/<entry>.js`). */
export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, entry: 'log' | 'push' | 'commit'): string {
  const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', name));
  const nonce = randomBytes(16).toString('hex');
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
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
  <script nonce="${nonce}" src="${asset(`${entry}.js`)}"></script>
</body>
</html>`;
}

export function webviewTransport(webview: vscode.Webview): Transport {
  return {
    post: (message) => void webview.postMessage(message),
    listen: (handler) => void webview.onDidReceiveMessage(handler),
  };
}
