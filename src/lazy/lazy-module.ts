// One way for every heavy part of the app to load: declared where it is
// used, loaded the first time it is needed. Plugins work this way already -
// a plugin's commands, menus and tabs are known from its manifest, and its
// code starts on first use (plugins/broker.ts) - and the app's own heavy
// parts follow the same rule: mermaid and KaTeX when a document has a
// diagram or formula, a language's strings when the UI is in it, Settings
// and the AI panel when they are opened. A part likely to be opened soon is
// "warm": it loads in the background once the window is idle, so the first
// open doesn't wait, and it stays out of the startup bundle either way.

export interface LazyModule<T> {
  readonly name: string;
  /** The module, loaded on the first call and shared after. A failed load
   *  is forgotten, so the next call tries again. */
  load(): Promise<T>;
  /** The module if it has loaded, for code that can go without it. */
  peek(): T | undefined;
  /** Forgets this module (a plugin turned off): it leaves loadedModules,
   *  and a later lazyModule under its name starts afresh. */
  drop(): void;
}

interface Entry {
  module: LazyModule<unknown>;
  warm: boolean;
  loaded: boolean;
}

const entries = new Map<string, Entry>();

/** Declares a part of the app that loads on first use. `name` identifies
 *  it in loadedModules (e2e and the startup budget read that). */
export function lazyModule<T>(
  name: string,
  loader: () => Promise<T>,
  options: { warm?: boolean } = {},
): LazyModule<T> {
  let pending: Promise<T> | null = null;
  let value: T | undefined;
  const module: LazyModule<T> = {
    name,
    load() {
      pending ??= loader().then(
        (loaded) => {
          value = loaded;
          const entry = entries.get(name);
          if (entry?.module === module) entry.loaded = true;
          return loaded;
        },
        (err: unknown) => {
          pending = null;
          throw err;
        },
      );
      return pending;
    },
    peek: () => value,
    drop() {
      if (entries.get(name)?.module === module) entries.delete(name);
    },
  };
  entries.set(name, {
    module: module as LazyModule<unknown>,
    warm: !!options.warm,
    loaded: false,
  });
  if (options.warm && warming) scheduleWarm();
  return module;
}

/** The parts loaded so far, by name. */
export function loadedModules(): string[] {
  return [...entries.values()]
    .filter((entry) => entry.loaded)
    .map((entry) => entry.module.name);
}

// For e2e/lazy-loading.spec.ts: what a development build has loaded.
if (import.meta.env?.DEV)
  (globalThis as { __loadedModules?: () => string[] }).__loadedModules =
    loadedModules;

let warming = false;
let scheduled = false;

/** From now on, warm parts load one at a time whenever the window is idle.
 *  Called once the first document has painted (main.tsx). */
export function startWarming(): void {
  warming = true;
  scheduleWarm();
}

function scheduleWarm() {
  if (scheduled) return;
  scheduled = true;
  whenIdle(async () => {
    scheduled = false;
    const next = [...entries.values()].find(
      (entry) => entry.warm && !entry.loaded,
    );
    if (!next) return;
    // A failed warm-up is left for the real first use to report.
    await next.module.load().catch(() => {});
    next.warm = false;
    scheduleWarm();
  });
}

function whenIdle(run: () => void) {
  const idle = (
    globalThis as {
      requestIdleCallback?: (
        cb: () => void,
        options?: { timeout: number },
      ) => number;
    }
  ).requestIdleCallback;
  // WebKit has no requestIdleCallback: a pause after the frame stands in.
  if (idle) idle(run, { timeout: 3000 });
  else setTimeout(run, 300);
}
