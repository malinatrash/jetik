import { useEffect, useState } from 'preact/hooks';

/** Minimal observable state container; components subscribe with `useStore`. */
export class Store<S> {
  private readonly listeners = new Set<() => void>();

  constructor(public state: S) {}

  protected set(patch: Partial<S>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function useStore<S>(store: Store<S>): S {
  const [, rerender] = useState(0);
  useEffect(() => store.subscribe(() => rerender((n) => n + 1)), [store]);
  return store.state;
}
