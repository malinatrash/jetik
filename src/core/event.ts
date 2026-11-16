export interface Disposable {
  dispose(): void;
}

export type Listener<T> = (event: T) => void;
export type Event<T> = (listener: Listener<T>) => Disposable;

/** Minimal event emitter so the git layer stays free of `vscode` imports. */
export class Emitter<T> implements Disposable {
  private readonly listeners = new Set<Listener<T>>();

  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(event: T): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
