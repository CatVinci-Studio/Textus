/**
 * Where the `/` panel's rows come from. The core's own lists (commands,
 * emoji, notes) and every plugin's completions are sources alike; the
 * panel matches each one's pattern before the caret and asks the matching
 * ones at once.
 */

export interface PanelItem {
  /** What the row shows. */
  label: string;
  /** What replaces the match; `$0` marks where the caret goes. */
  insert: string;
  /** A word or two beside the label, dimmed. */
  detail?: string;
  /** One of the panel's icons, an SVG, or (the core's) one character. */
  icon?: string;
  /** Also found by: an English name, an alias. */
  keywords?: string;
  /** Characters after the caret it replaces too: the "]]" paired with "[[". */
  replaceAfter?: number;
  /** Run once it is inserted. */
  run?: () => void;
}

export interface CompletionContext {
  /** Before the caret, in its paragraph or formula. */
  text: string;
  /** What the pattern matched, which an item replaces. */
  match: string;
  /** The pattern's last capture group; the match without one. */
  query: string;
  /** After the caret, to the end of its block. */
  after: string;
  inMath: boolean;
  /** The document's path; null for an unsaved one. */
  path: string | null;
}

/** A whole list the panel filters itself while the same match goes on. */
export interface CompleteList {
  items: PanelItem[];
  complete: true;
}

export type CompletionAnswer = PanelItem[] | CompleteList | null;

export interface CompletionSource {
  /** "textus.slash", "<plugin>.<completion id>". */
  id: string;
  /** "core", or the plugin's id. */
  owner: string;
  where: "math" | "text" | "any";
  /** Anchored at the caret: `(?:…)$`. */
  pattern: RegExp;
  /** The capture group an item replaces; the whole match without it. The
   *  core's patterns need it: what starts a word isn't replaced. */
  replaceGroup?: number;
  /** Left out when a plugin's source matches from the same place. */
  fallback?: boolean;
  /** The group's heading. */
  title(): string;
  provide(
    context: CompletionContext,
    signal: AbortSignal,
  ): CompletionAnswer | Promise<CompletionAnswer>;
}

const core = new Set<CompletionSource>();
let pluginSources: () => readonly CompletionSource[] = () => [];
let cachedFor: readonly CompletionSource[] | null = null;
let coreVersion = 0;
let cachedVersion = -1;
let cached: CompletionSource[] = [];

/** A source of the core's, until the returned function takes it away. */
export function addCompletionSource(source: CompletionSource): () => void {
  core.add(source);
  coreVersion++;
  return () => {
    if (core.delete(source)) coreVersion++;
  };
}

/** Where the plugins' sources are read, kept current by the plugin system. */
export function setPluginCompletionSources(
  read: () => readonly CompletionSource[],
): void {
  pluginSources = read;
  cachedFor = null;
}

/** Every source, the core's first. The same array while nothing changed. */
export function completionSources(): readonly CompletionSource[] {
  const plugins = pluginSources();
  if (plugins !== cachedFor || cachedVersion !== coreVersion) {
    cachedFor = plugins;
    cachedVersion = coreVersion;
    cached = [...core, ...plugins];
  }
  return cached;
}
