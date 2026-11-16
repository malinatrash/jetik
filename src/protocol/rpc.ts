/**
 * Typed request/response + event channel over `postMessage`, shared by the extension host
 * and the webviews. The API is an interface whose methods all return promises.
 */
export interface Transport {
  post(message: unknown): void;
  listen(handler: (message: unknown) => void): void;
}

type Message =
  | { kind: 'request'; id: number; method: string; args: unknown[] }
  | { kind: 'response'; id: number; value?: unknown; error?: string }
  | { kind: 'event'; name: string; payload: unknown };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AsyncApi<T> = { [K in keyof T]: (...args: any[]) => Promise<unknown> };

export interface Client<Api, Events> {
  api: Api;
  on<K extends keyof Events>(name: K, handler: (payload: Events[K]) => void): void;
}

export interface Server<Events> {
  emit<K extends keyof Events>(name: K, payload: Events[K]): void;
}

/** Webview side: call the host through `client.api.method(...)`. */
export function connect<Api extends AsyncApi<Api>, Events>(transport: Transport): Client<Api, Events> {
  let nextId = 1;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const handlers = new Map<string, ((payload: never) => void)[]>();

  transport.listen((raw) => {
    const message = raw as Message;
    if (message.kind === 'response') {
      const call = pending.get(message.id);
      pending.delete(message.id);
      if (message.error !== undefined) call?.reject(new Error(message.error));
      else call?.resolve(message.value);
    } else if (message.kind === 'event') {
      for (const handler of handlers.get(message.name) ?? []) handler(message.payload as never);
    }
  });

  const api = new Proxy({} as Api, {
    get:
      (_, method: string) =>
      (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          transport.post({ kind: 'request', id, method, args } satisfies Message);
        }),
  });

  return {
    api,
    on(name, handler) {
      const list = handlers.get(name as string) ?? [];
      list.push(handler as (payload: never) => void);
      handlers.set(name as string, list);
    },
  };
}

/** Host side: answer requests with `handlers` and push events to the webview. */
export function serve<Api extends AsyncApi<Api>, Events>(
  transport: Transport,
  handlers: Api,
  onError?: (method: string, error: unknown) => void,
): Server<Events> {
  transport.listen(async (raw) => {
    const message = raw as Message;
    if (message.kind !== 'request') return;
    try {
      const method = handlers[message.method as keyof Api];
      const value = await method.apply(handlers, message.args);
      transport.post({ kind: 'response', id: message.id, value } satisfies Message);
    } catch (error) {
      onError?.(message.method, error);
      const text = error instanceof Error ? error.message : String(error);
      transport.post({ kind: 'response', id: message.id, error: text } satisfies Message);
    }
  });
  return {
    emit: (name, payload) => transport.post({ kind: 'event', name: name as string, payload } satisfies Message),
  };
}
