import { connect, type AsyncApi, type Client } from '../../src/protocol/rpc';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

export function connectHost<Api extends AsyncApi<Api>, Events>(): Client<Api, Events> {
  return connect<Api, Events>({
    post: (message) => vscode.postMessage(message),
    listen: (handler) => window.addEventListener('message', (event) => handler(event.data)),
  });
}

/** State that survives the webview being hidden and restored. */
export const persisted = {
  get<T>(key: string, fallback: T): T {
    const state = (vscode.getState() ?? {}) as Record<string, unknown>;
    return key in state ? (state[key] as T) : fallback;
  },
  set(key: string, value: unknown): void {
    vscode.setState({ ...((vscode.getState() ?? {}) as object), [key]: value });
  },
};
