import type { MilkdownPlugin } from "@milkdown/kit/ctx";

/**
 * What the editor lets others add: the plugin system registers its parts
 * here (plugins/contributions/plugin-contributions.ts), and the editor reads
 * them. Without it - the playground - each is empty.
 */

/** What the pointer rests on: a document link, another link, a citation. */
export type HoverTarget =
  | {
      type: "document";
      path: string;
      heading: string | null;
      /** A `^id` block the link points at, without "^". */
      block?: string | null;
    }
  | { type: "link"; url: string }
  | { type: "citation"; key: string };

export interface HoverCard {
  title: string | null;
  /** Shown as Markdown, with no pictures. */
  markdown: string;
  /** The app's, never a plugin's: Open on a document's card goes to it. */
  open?: () => void;
}

export {
  addCompletionSource,
  setPluginCompletionSources,
  type CompletionAnswer,
  type CompletionContext,
  type CompletionSource,
  type PanelItem,
} from "./completion/sources";

export {
  addEmbedProvider,
  embedProvider,
  refreshEmbeds,
  setEmbedOwners,
  setEmbedStarter,
  type EmbedContent,
  type EmbedKind,
} from "./embeds/embed-sources";

interface EditorExtensions {
  /** Editor plugins that see keys before the editor's own (a plugin
   *  holding the keyboard, as Vim's normal mode does). */
  keyInput: MilkdownPlugin[];
  hasHoverProviders: () => boolean;
  /** The first card someone has for `target`, or null. */
  provideHover: (target: HoverTarget) => Promise<HoverCard | null>;
  /** Opens a web link in what handles it; false when nothing does. */
  openLink: (url: string) => boolean;
  /** Whether someone turns pasted `text` into Markdown of its own, and
   *  that Markdown (null: paste as usual). */
  pasteMatches: (text: string) => boolean;
  providePaste: (text: string) => Promise<string | null>;
}

let current: EditorExtensions = {
  keyInput: [],
  hasHoverProviders: () => false,
  provideHover: async () => null,
  openLink: () => false,
  pasteMatches: () => false,
  providePaste: async () => null,
};

export function setEditorExtensions(next: Partial<EditorExtensions>): void {
  current = { ...current, ...next };
}

export function editorExtensions(): EditorExtensions {
  return current;
}
