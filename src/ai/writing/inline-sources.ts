import { useSyncExternalStore } from "react";
import { createSubscribers } from "../../utils/store";

/** What a plugin's inline completion is asked with. */
interface InlineRequest {
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
const listeners = createSubscribers();

function changed(next: readonly InlineSource[]) {
  sources = next;
  listeners.publish();
}

/** A source, until the returned function takes it away. */
export function addInlineSource(source: InlineSource): () => void {
  changed([...sources.filter((s) => s.key !== source.key), source]);
  return () => {
    if (sources.includes(source)) changed(sources.filter((s) => s !== source));
  };
}

/** What the setting names: Textus AI's own, a plugin's source, or null
 *  for a plugin's that isn't there now - which offers nothing, never
 *  Textus AI in its place. */
export function chosenSource(key: string): InlineSource | "textus" | null {
  if (key === TEXTUS_SOURCE) return TEXTUS_SOURCE;
  return sources.find((s) => s.key === key) ?? null;
}

export function useInlineSources(): readonly InlineSource[] {
  return useSyncExternalStore(listeners.subscribe, () => sources);
}
