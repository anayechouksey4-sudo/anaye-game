import { useCallback, useSyncExternalStore } from 'react';

/**
 * Minimal external store. Socket traffic (10 Hz telemetry, 30 Hz controls echo) lands here instead of in
 * React state at the root, so only the components that select a changed slice re-render.
 */
export interface Store<T extends object> {
  getState(): T;
  /** Shallow-merges `patch` (or the result of `update(prev)`) and notifies only if something changed. */
  setState(patch: Partial<T> | ((prev: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState(patch) {
      const partial = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const key of Object.keys(partial) as (keyof T)[]) {
        if (!Object.is(state[key], partial[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...partial };
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Subscribe to a slice. The selector must return a primitive or a reference that already lives in the
 * state (never a freshly built object), otherwise every store update would look like a change.
 */
export function useStore<T extends object, S>(store: Store<T>, selector: (state: T) => S): S {
  const getSnapshot = useCallback(() => selector(store.getState()), [store, selector]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
