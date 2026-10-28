import type { MilkdownPlugin } from "@milkdown/kit/ctx";

/**
 * What the editor lets others add: the plugin system registers its parts
 * here (plugins/contributions/plugin-contributions.ts), and the editor reads
 * them. Without it - the playground - each is empty.
 */

/** What the pointer rests on: a document link, another link, a citation. */
export type HoverTarget =
  | { type: "document"; path: string; heading: string | null }
  | { type: "link"; url: string }
  | { type: "citation"; key: string };

export interface HoverCard {
  title: string | null;
  /** Shown as Markdown, with no pictures. */
  markdown: string;
  /** The app's, never a plugin's: Open on a document's card goes to it. */
  open?: () => void;
}

export interface CompletionItem {
  /** What the list shows. */
  label: string;
  /** What replaces the matched text; `$0` marks where the caret goes. */
  insert: string;
  /** A word or two beside the label, dimmed. */
  detail?: string;
  /** Run once the item is taken (a `/` command): what was typed goes, and
   *  `insert` is empty. */
  run?: () => void;
}

export interface CompletionResult {
  /** How many characters before the caret the item replaces: the match. */
  replace: number;
  items: CompletionItem[];
}

export interface EditorExtensions {
  /** Editor plugins that see keys before the editor's own (a plugin
   *  holding the keyboard, as Vim's normal mode does). */
  keyInput: MilkdownPlugin[];
  hasHoverProviders: () => boolean;
  /** The first card someone has for `target`, or null. */
  provideHover: (target: HoverTarget) => Promise<HoverCard | null>;
  hasCompletionSources: () => boolean;
  /** The first list someone has for the text before the caret. */
  provideCompletions: (
    text: string,
    inMath: boolean,
  ) => Promise<CompletionResult | null>;
  /** Opens a web link in what handles it; false when nothing does. */
  openLink: (url: string) => boolean;
}

let current: EditorExtensions = {
  keyInput: [],
  hasHoverProviders: () => false,
  provideHover: async () => null,
  hasCompletionSources: () => false,
  provideCompletions: async () => null,
  openLink: () => false,
};

export function setEditorExtensions(next: Partial<EditorExtensions>): void {
  current = { ...current, ...next };
}

export function editorExtensions(): EditorExtensions {
  return current;
}
