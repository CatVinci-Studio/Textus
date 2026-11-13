import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { closeHistory } from "@milkdown/kit/prose/history";
import { resolveStrings } from "../../i18n/strings";
import {
  canPickImageFile,
  canRevealInFileManager,
} from "../../platform/capabilities";
import { fs } from "../../platform/ipc";
import { isScopedUrl } from "../../platform/ios-files";
import type { Settings } from "../../prefs/SettingsContext";
import { showMessage } from "../../engine/controls/app-dialog";
import { basename, dirname, isInside } from "../../utils/path";
import { localPath } from "../markdown/link-target";
import {
  applyReveal,
  caretToSourceOnClick,
  revealAll,
  type Reveal,
  type RevealState,
} from "../reveal-state";
import { showDocImage } from "./image-plugin";
import { openDiagramViewer, zoomButton } from "../diagram-zoom";
import { copyToImageFolder, pickImageFile } from "./image-store";
import {
  MISSING_IMAGE_CLASS,
  isMissingCardAction,
  missingImageCard,
  revealNearest,
  type ImageLocation,
  type MissingReason,
} from "./missing-image";
import { embedForPicked, parseEmbed, type EmbedTarget } from "./obsidian-embed";
import { explainError } from "../../utils/error-explain";
import { windowFolder } from "../../platform/window-folder";

const embedPreviewKey = new PluginKey<RevealState>("obsidian-embed-preview");

/**
 * The src an HTML export writes for an embed's picture: relative when the
 * file is in the document's folder or below, else the full path, since a
 * "../" one breaks once the export moves.
 */
export function exportSrc(file: string, docPath: string): string {
  const dir = dirname(docPath);
  if (!isInside(file, dir)) return file;
  return file
    .slice(dir.length)
    .split(/[\\/]/)
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

/**
 * "Choose image…" on a missing embed's card: the picked file is copied into
 * the image folder (never uploaded: an embed names a vault file). A vault
 * that writes wiki links keeps an embed, by the name it gives; elsewhere it
 * becomes a Markdown image with a path from the document, which can't name
 * another note's `assets/x.png`. One undo step.
 */
async function replaceEmbed(
  view: EditorView,
  getPos: () => number | undefined,
  docPath: string,
  settings: () => Settings,
): Promise<void> {
  const t = resolveStrings(settings().language);
  const path = await pickImageFile(settings().language);
  if (!path) return;
  try {
    const stored = await copyToImageFolder(path, {
      docPath: () => docPath,
      settings,
    });
    const widgetPos = getPos();
    if (stored === null || widgetPos === undefined) return;
    // The widget sits right after its embed (side -1).
    const node = view.state.doc.resolve(widgetPos).nodeBefore;
    if (node?.type.name !== "obsidian_embed") return;
    const { schema } = view.state;
    const picked = embedForPicked(node.textContent, stored);
    const replacement =
      "embed" in picked
        ? node.type.create(node.attrs, schema.text(picked.embed))
        : schema.nodes.image.create(picked);
    view.dispatch(
      closeHistory(
        view.state.tr.replaceWith(
          widgetPos - node.nodeSize,
          widgetPos,
          replacement,
        ),
      ),
    );
  } catch (err) {
    void showMessage(`${t.missingImageChooseFailed}\n${explainError(err, t)}`, {
      tone: "error",
    });
  }
}

/** Each embed picture's file in the vault, or where it was looked for.
 *  Kept off the DOM, which an export copies. */
const embedFiles = new WeakMap<Element, string>();

/** The picture an image embed names, found in the vault by the backend, or
 *  the missing image's card. */
function embedWidget(
  embed: EmbedTarget,
  docPath: string,
  settings: () => Settings,
) {
  return (view: EditorView, getPos: () => number | undefined) => {
    const el = document.createElement("span");
    el.className = "image-view obsidian-embed-rendered";
    const img = document.createElement("img");
    img.alt = embed.alt;
    if (embed.width) img.style.width = `${embed.width}px`;
    if (embed.height) img.style.height = `${embed.height}px`;
    // As any picture: enlarged from its corner or a double click, and a
    // click leaves it on show; the source comes up as the caret reaches it.
    const loaded = () => (img.naturalWidth > 0 ? img : null);
    el.append(img);
    el.append(zoomButton(el, loaded));
    img.addEventListener("mousedown", (event) => {
      if (event.button === 0) event.preventDefault();
    });
    img.addEventListener("dblclick", () => {
      if (loaded()) openDiagramViewer(img, el);
    });
    // `path`: the file found, or where the link would be beside the document.
    const missing = (reason: MissingReason, path: string | null) => {
      const location: ImageLocation = path
        ? { kind: "local", path }
        : { kind: "other" };
      if (path) embedFiles.set(el, path);
      const card = missingImageCard(
        {
          name: basename(embed.path),
          alt: embed.alt,
          reason,
          location,
          onChoose: canPickImageFile
            ? () => void replaceEmbed(view, getPos, docPath, settings)
            : undefined,
          onReveal:
            canRevealInFileManager && path
              ? () => revealNearest(path)
              : undefined,
        },
        resolveStrings(settings().language),
      );
      // The name as written stays for an export, which drops the card.
      const name = document.createElement("span");
      name.className = "image-missing-name";
      name.textContent = embed.path;
      el.classList.add(MISSING_IMAGE_CLASS);
      el.replaceChildren(name, card);
    };
    fs.resolveVaultImage(docPath, embed.path, windowFolder())
      .then((file) => {
        if (!file) return missing("notInVault", localPath(embed.path, docPath));
        embedFiles.set(el, file);
        img.addEventListener("error", () => missing("unsupported", file));
        showDocImage(img, file, docPath);
        img.dataset.docSrc = exportSrc(file, docPath);
      })
      .catch(() => missing("failed", null));
    // A missing picture's card: a click puts the caret on the source to
    // mend it. A right-click is for the menu, which would lose it.
    caretToSourceOnClick(
      el,
      view,
      getPos,
      (event) =>
        !el.classList.contains(MISSING_IMAGE_CLASS) ||
        isMissingCardAction(event) ||
        (event as MouseEvent).button !== 0 ||
        (event as MouseEvent).ctrlKey,
    );
    return el;
  };
}

/** The vault file the embed picture at `target` shows, or where it was
 *  looked for; null off an embed or before the vault answered. */
export function embedFileAt(target: Element): string | null {
  const el = target.closest(".obsidian-embed-rendered");
  return (el && embedFiles.get(el)) ?? null;
}

interface EmbedPreviewOptions {
  docPath: () => string | null;
  settings: () => Settings;
}

const isEmbed = (node: ProseNode) => node.type.name === "obsidian_embed";

function embedReveal(options: EmbedPreviewOptions): Reveal {
  return {
    match: isEmbed,
    decorate(node, pos, touches) {
      const docPath = options.docPath();
      // An unsaved document has no vault; an iOS Files one can't be searched.
      if (!docPath || isScopedUrl(docPath)) return [];
      const embed = parseEmbed(node.textContent);
      const to = pos + node.nodeSize;
      if (!embed?.isImage || touches(pos, to)) return [];
      return [
        Decoration.inline(pos + 1, to - 1, {
          class: "obsidian-embed-source-hidden",
        }),
        Decoration.widget(to, embedWidget(embed, docPath, options.settings), {
          side: -1,
          key: `${docPath}\n${node.textContent}`,
          // The picture's clicks are its own, not a caret placed at it.
          stopEvent: (event) =>
            isMissingCardAction(event) ||
            (event.target instanceof Element &&
              !!event.target.closest(
                ".obsidian-embed-rendered img, .mermaid-zoom",
              )),
        }),
      ];
    },
    config: options.docPath,
  };
}

/** Obsidian image embeds as pictures while the caret is away. */
export function createObsidianEmbedPreviewPlugin(options: EmbedPreviewOptions) {
  const reveal = embedReveal(options);
  return $prose(
    () =>
      new Plugin<RevealState>({
        key: embedPreviewKey,
        state: {
          init: (_config, state) => revealAll(state, reveal),
          apply: (tr, prev, oldState, newState) =>
            applyReveal(tr, prev, oldState, newState, reveal),
        },
        props: {
          decorations: (state) => embedPreviewKey.getState(state)?.set,
        },
      }),
  );
}
