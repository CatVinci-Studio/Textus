import { useSyncExternalStore } from "react";

/** What a plugin's inline completion is asked with. */
export interface InlineRequest {
  before: string;
  after: string;
  path: string | null;
}

/**
 * A plugin's inline completion: the grey text after the caret when typing
 * pauses. Settings › AI picks one source at a time, Textus AI or one of
 * these (`completionSource`, by `key`).
 */
export interface InlineSource {
  /** `<plugin id>#<its id>`. */
  key: string;
  plugin: string;
  label: string;
  provide(request: InlineRequest): Promise<string | null>;
}

/** Textus AI's own completion, as the setting names it. */
export const TEXTUS_SOURCE = "textus";

let sources: readonly InlineSource[] = [];
const listeners = new Set<() => void>();

function changed(next: readonly InlineSource[]) {
  sources = next;
  for (const listen of listeners) listen();
}

/** A source, until the returned function takes it away. */
export function addInlineSource(source: InlineSource): () => void {
  changed([...sources.filter((s) => s.key !== source.key), source]);
  return () => {
    if (sources.includes(source))
      changed(sources.filter((s) => s !== source));
  };
}

/** The plugin's source the setting names, or undefined for Textus AI's own
 *  (or a source that isn't there now). */
export function inlineSource(key: string): InlineSource | undefined {
  return key === TEXTUS_SOURCE ? undefined : sources.find((s) => s.key === key);
}

export function useInlineSources(): readonly InlineSource[] {
  return useSyncExternalStore(
    (listen) => {
      listeners.add(listen);
      return () => listeners.delete(listen);
    },
    () => sources,
  );
}
