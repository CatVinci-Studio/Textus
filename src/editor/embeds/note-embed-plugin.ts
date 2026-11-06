import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { isScopedUrl } from "../../platform/ios-files";
import { windowFolder } from "../../platform/window-folder";
import { OPEN_FILE_IN_TAB_EVENT, type OpenFileInTab } from "../../utils/events";
import {
  embedKey,
  embedKind,
  fillEmbed,
  noteEmbedOf,
} from "./note-embed-render";
import { embedProvider, onEmbedsChange } from "./embed-sources";
import "./note-embed.css";
import {
  applyReveal,
  caretToSourceOnClick,
  revealAll,
  type Reveal,
  type RevealState,
} from "../reveal-state";

const key = new PluginKey<RevealState>("note-embed");

/** What each embed showed last, so a redraw starts from it, not empty. */
const lastShown = new Map<string, string>();

interface EmbedView {
  docPath: () => string | null;
  /** Bumped to ask every embed again. */
  generation: number;
  /** The notes this editor's embeds were read from. */
  read: Set<string>;
  /** Called off when the embeds are drawn again. */
  asks: AbortController;
}

/** Opens the embed's source at its heading or block. */
function openSource(el: HTMLElement): void {
  const path = el.closest<HTMLElement>(".note-embed")?.dataset.path;
  if (!path) return;
  const anchor = el.closest<HTMLElement>(".note-embed")?.dataset.anchor;
  window.dispatchEvent(
    new CustomEvent<OpenFileInTab>(OPEN_FILE_IN_TAB_EVENT, {
      detail: { path, ...(anchor ? { anchor } : {}) },
    }),
  );
}

function embedWidget(state: EmbedView, source: string, docPath: string) {
  return (view: EditorView, getPos: () => number | undefined) => {
    const el = document.createElement("span");
    el.className = "note-embed";
    el.contentEditable = "false";
    const remembered = lastShown.get(`${docPath}\n${source}`);
    if (remembered) el.innerHTML = remembered;
    const link = noteEmbedOf(source)!;
    void fillEmbed(el, link, {
      docPath,
      folder: windowFolder(),
      depth: 1,
      chain: [embedKey(docPath)],
      signal: state.asks.signal,
      read: (path) => state.read.add(path.replace(/\\/g, "/")),
    }).then(() => {
      if (!state.asks.signal.aborted)
        lastShown.set(`${docPath}\n${source}`, el.innerHTML);
    });
    el.addEventListener("click", (event) => {
      const title = (event.target as Element).closest?.(".note-embed-title");
      if (title instanceof HTMLElement) openSource(title);
    });
    // The body puts the caret on the source; a title or a held link is a click.
    caretToSourceOnClick(
      el,
      view,
      getPos,
      (event) =>
        (event as MouseEvent).button !== 0 ||
        (event as MouseEvent).metaKey ||
        (event as MouseEvent).ctrlKey ||
        !!(event.target as Element).closest?.(".note-embed-title"),
    );
    return el;
  };
}

function embedReveal(state: EmbedView): Reveal {
  return {
    match: (node: ProseNode) => node.type.name === "obsidian_embed",
    decorate(node, pos, touches) {
      const docPath = state.docPath();
      if (!docPath || isScopedUrl(docPath)) return [];
      const source = node.textContent;
      const link = noteEmbedOf(source);
      const to = pos + node.nodeSize;
      if (!link || !embedProvider(embedKind(link)) || touches(pos, to))
        return [];
      return [
        Decoration.inline(pos + 1, to - 1, {
          class: "obsidian-embed-source-hidden",
        }),
        Decoration.widget(to, embedWidget(state, source, docPath), {
          side: -1,
          key: `${docPath}\n${source}\n${state.generation}`,
        }),
      ];
    },
    config: () => `${state.docPath()}\n${state.generation}`,
  };
}

/** `![[note]]`, `![[note#heading]]` and `![[note#^block]]` drawn read-only
 *  while the caret is away, when a plugin gives their content. */
export function createNoteEmbedPlugin(docPath: () => string | null) {
  return $prose(() => {
    const state: EmbedView = {
      docPath,
      generation: 0,
      read: new Set(),
      asks: new AbortController(),
    };
    const reveal = embedReveal(state);
    return new Plugin<RevealState>({
      key,
      state: {
        init: (_config, editorState) => revealAll(editorState, reveal),
        apply: (tr, prev, oldState, newState) =>
          applyReveal(tr, prev, oldState, newState, reveal),
      },
      props: {
        decorations: (editorState) => key.getState(editorState)?.set,
      },
      view(view) {
        const stop = onEmbedsChange((path) => {
          if (path && !state.read.has(path.replace(/\\/g, "/"))) return;
          state.asks.abort();
          state.asks = new AbortController();
          state.read.clear();
          state.generation++;
          view.dispatch(view.state.tr.setMeta(key, state.generation));
        });
        return {
          destroy() {
            stop();
            state.asks.abort();
          },
        };
      },
    });
  });
}
