import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { fs } from "../../platform/ipc";
import { isScopedUrl } from "../../platform/ios-files";
import {
  applyReveal,
  buildReveal,
  caretToSourceOnClick,
  type RevealState,
} from "../reveal-state";
import { showDocImage } from "./image-plugin";
import { parseEmbed, type EmbedTarget } from "./obsidian-embed";

const embedPreviewKey = new PluginKey<RevealState>("obsidian-embed-preview");

/** The picture an image embed names, found in the document's vault by the
 *  backend. One it can't find shows its name in muted text instead. */
function embedWidget(embed: EmbedTarget, docPath: string) {
  return (view: EditorView, getPos: () => number | undefined) => {
    const el = document.createElement("span");
    el.className = "image-view obsidian-embed-rendered";
    const img = document.createElement("img");
    img.alt = embed.alt;
    if (embed.width) img.style.width = `${embed.width}px`;
    if (embed.height) img.style.height = `${embed.height}px`;
    el.append(img);
    const missing = () => {
      el.classList.add("obsidian-embed-missing");
      el.replaceChildren(embed.path);
    };
    fs.resolveVaultImage(docPath, embed.path)
      .then((file) => (file ? showDocImage(img, file, docPath) : missing()))
      .catch(missing);
    caretToSourceOnClick(el, view, getPos);
    return el;
  };
}

function buildDecorations(
  state: EditorState,
  docPath: string | null,
): RevealState {
  return buildReveal(state, (touches) => {
    const decorations: Decoration[] = [];
    // An unsaved document has no vault; one picked in the iOS Files app is
    // read through the system, which a vault search can't walk.
    if (!docPath || isScopedUrl(docPath)) return decorations;
    state.doc.descendants((node, pos) => {
      if (node.type.name !== "obsidian_embed") return;
      const embed = parseEmbed(node.textContent);
      const to = pos + node.nodeSize;
      if (!embed?.isImage || touches(pos, to)) return;
      decorations.push(
        Decoration.inline(pos + 1, to - 1, {
          class: "obsidian-embed-source-hidden",
        }),
        Decoration.widget(to, embedWidget(embed, docPath), {
          side: -1,
          key: `${docPath}\n${node.textContent}`,
        }),
      );
    });
    return decorations;
  });
}

/**
 * Obsidian image embeds (obsidian-embed.ts) as pictures, the way
 * raw-html-preview-plugin.ts shows an <img>: while the caret is away the
 * source hides behind the picture; on it, the source is back to edit.
 */
export function createObsidianEmbedPreviewPlugin(options: {
  docPath: () => string | null;
}) {
  return $prose(
    () =>
      new Plugin<RevealState>({
        key: embedPreviewKey,
        state: {
          init: (_config, state) => buildDecorations(state, options.docPath()),
          apply: (tr, prev, oldState, newState) =>
            applyReveal(tr, prev, oldState, newState, (state) =>
              buildDecorations(state, options.docPath()),
            ),
        },
        props: {
          decorations: (state) => embedPreviewKey.getState(state)?.set,
        },
      }),
  );
}
