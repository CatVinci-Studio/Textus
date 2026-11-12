import { openDocument } from "../../utils/open-document";
import { foldButtonKey, showBlockFold } from "../fold/block-fold";
import { onMemoryIdle } from "../../utils/memory-idle";
import { slashed } from "../../utils/path";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { isScopedUrl } from "../../platform/ios-files";
import { windowFolder } from "../../platform/window-folder";
import {
  embedDepthOf,
  embedKey,
  embedKind,
  fillEmbed,
  noteEmbedOf,
  releaseEmbed,
} from "./note-embed-render";
import { embedFolded, setEmbedFolded } from "./embed-folds";
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
/** Embeds remembered at most; the oldest goes first. */
const SHOWN_KEPT = 200;
onMemoryIdle(() => lastShown.clear());

interface EmbedView {
  docPath: () => string | null;
  /** Bumped to ask every embed again. */
  generation: number;
  /** The notes this editor's embeds were read from. */
  read: Set<string>;
  /** Called off when the embeds are drawn again. */
  asks: AbortController;
}

/** Folds the embed to its line, or shows it again; remembered here. */
function toggleFold(embed: HTMLElement, key: string): void {
  const folded = !embed.hasAttribute("data-folded");
  showBlockFold(embed, folded);
  setEmbedFolded(key, folded);
}

/** Opens the embed's source at its heading or block. */
function openSource(el: HTMLElement): void {
  const path = el.closest<HTMLElement>(".note-embed")?.dataset.path;
  if (!path) return;
  const anchor = el.closest<HTMLElement>(".note-embed")?.dataset.anchor;
  openDocument(path, anchor ? { anchor } : {});
}

function embedWidget(state: EmbedView, source: string, docPath: string) {
  return (view: EditorView, getPos: () => number | undefined) => {
    const el = document.createElement("span");
    el.className = "note-embed";
    el.contentEditable = "false";
    const remembered = lastShown.get(`${docPath}\n${source}`);
    if (remembered) {
      el.innerHTML = remembered;
      // Folded before: folded again at once, not after a flash of it all.
      const key = el.querySelector<HTMLElement>(":scope > .block-fold")?.dataset
        .key;
      if (key) showBlockFold(el, embedFolded(key));
    }
    const link = noteEmbedOf(source)!;
    // Inside another embed's drawing: one level down from it.
    const outer = embedDepthOf(view.dom);
    void fillEmbed(el, link, {
      docPath,
      folder: windowFolder(),
      depth: outer.depth,
      chain: [...outer.chain, embedKey(docPath)],
      signal: state.asks.signal,
      read: (path) => state.read.add(slashed(path)),
    }).then(() => {
      if (state.asks.signal.aborted) return;
      const key = `${docPath}\n${source}`;
      lastShown.delete(key);
      lastShown.set(key, el.innerHTML);
      if (lastShown.size > SHOWN_KEPT)
        lastShown.delete(lastShown.keys().next().value!);
    });
    el.addEventListener("click", (event) => {
      const target = event.target as Element;
      const key = foldButtonKey(target);
      const embed = target.closest?.(".block-foldable");
      if (key && embed instanceof HTMLElement) return toggleFold(embed, key);
      const open = target.closest?.(".note-embed-open");
      if (open instanceof HTMLElement) openSource(open);
    });
    // The body puts the caret on the source; its buttons, a plugin's block
    // or a held link is a click.
    caretToSourceOnClick(
      el,
      view,
      getPos,
      (event) =>
        (event as MouseEvent).button !== 0 ||
        (event as MouseEvent).metaKey ||
        (event as MouseEvent).ctrlKey ||
        !!(event.target as Element).closest?.(
          ".block-fold, .block-folded-line, .note-embed-open",
        ),
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
          destroy: (el) => releaseEmbed(el as HTMLElement),
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
          if (path && !state.read.has(slashed(path))) return;
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
