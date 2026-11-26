import { openDocument } from "../../utils/open-document";
import { foldButtonKey, showBlockFold } from "../fold/block-fold";
import { onMemoryIdle } from "../../utils/memory-idle";
import { keepFresh } from "../../utils/keep-fresh";
import { slashed } from "../../utils/path";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { isFarUrl } from "../../platform/far-files";
import type { Settings } from "../../prefs/SettingsContext";
import { imageEmbedDecorations } from "../images/obsidian-embed-preview";
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
import { drawWhileNear, stopDrawing } from "../lazy/draw-when-visible";
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
    const link = noteEmbedOf(source)!;
    // Inside another embed's drawing: one level down from it.
    const outer = embedDepthOf(view.dom);
    const key = `${docPath}\n${source}`;
    let drawing: AbortController | null = null;
    const fill = () => {
      const remembered = lastShown.get(key);
      if (remembered) {
        el.innerHTML = remembered;
        // Folded before: folded again at once, not after a flash of it all.
        const fold = el.querySelector<HTMLElement>(":scope > .block-fold")
          ?.dataset.key;
        if (fold) showBlockFold(el, embedFolded(fold));
      }
      // Called off when let go, as when every embed is asked again.
      const asked = new AbortController();
      drawing = asked;
      state.asks.signal.addEventListener("abort", () => asked.abort(), {
        once: true,
      });
      void fillEmbed(el, link, {
        docPath,
        folder: windowFolder(),
        depth: outer.depth,
        chain: [...outer.chain, embedKey(docPath)],
        signal: asked.signal,
        read: (path) => state.read.add(slashed(path)),
      }).then(() => {
        if (asked.signal.aborted) return;
        keepFresh(lastShown, key, el.innerHTML, SHOWN_KEPT);
      });
    };
    // A note drawn in the note is a whole read-only editor: kept only
    // within a few screens, its size held when let go.
    drawWhileNear(
      el,
      view.dom,
      fill,
      () => {
        drawing?.abort();
        releaseEmbed(el);
        el.replaceChildren();
      },
      true,
    );
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

function embedReveal(state: EmbedView, settings: () => Settings): Reveal {
  return {
    match: (node: ProseNode) => node.type.name === "obsidian_embed",
    decorate(node, pos, touches) {
      const docPath = state.docPath();
      // An unsaved document has no vault; an iOS Files one can't be searched.
      if (!docPath || isFarUrl(docPath)) return [];
      if (touches(pos, pos + node.nodeSize)) return [];
      const image = imageEmbedDecorations(node, pos, docPath, settings);
      return image.length ? image : noteDecorations(state, node, pos, docPath);
    },
    config: () => `${state.docPath()}\n${state.generation}`,
  };
}

function noteDecorations(
  state: EmbedView,
  node: ProseNode,
  pos: number,
  docPath: string,
): Decoration[] {
  const source = node.textContent;
  const link = noteEmbedOf(source);
  if (!link || !embedProvider(embedKind(link))) return [];
  const to = pos + node.nodeSize;
  return [
    Decoration.inline(pos + 1, to - 1, {
      class: "obsidian-embed-source-hidden",
    }),
    Decoration.widget(to, embedWidget(state, source, docPath), {
      side: -1,
      key: `${docPath}\n${source}\n${state.generation}`,
      destroy: (el) => {
        stopDrawing(el);
        releaseEmbed(el as HTMLElement);
      },
    }),
  ];
}

/** `![[...]]` while the caret is away: a picture as the picture; a note,
 *  `![[note#heading]]` or `![[note#^block]]` drawn read-only when a plugin
 *  gives their content. One plugin for both, so the document is walked once. */
export function createEmbedsPlugin(
  docPath: () => string | null,
  settings: () => Settings,
) {
  return $prose(() => {
    const state: EmbedView = {
      docPath,
      generation: 0,
      read: new Set(),
      asks: new AbortController(),
    };
    const reveal = embedReveal(state, settings);
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
