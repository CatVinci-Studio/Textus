import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { closeHistory } from "@milkdown/kit/prose/history";
import { resolveStrings } from "../../i18n/strings";
import {
  canPickImageFile,
  canRevealInFileManager,
} from "../../platform/capabilities";
import { fs } from "../../platform/ipc";
import { isScopedUrl } from "../../platform/ios-files";
import type { Settings } from "../../settings/SettingsContext";
import { showMessage } from "../../ui/app-dialog";
import { errorText } from "../../utils/error-text";
import { basename, dirname, isInside } from "../../utils/path";
import { localPath } from "../markdown/link-target";
import {
  applyReveal,
  buildReveal,
  caretToSourceOnClick,
  type RevealState,
} from "../reveal-state";
import { copyToImageFolder, pickImageFile, showDocImage } from "./image-plugin";
import {
  MISSING_IMAGE_CLASS,
  isMissingCardAction,
  missingImageCard,
  revealNearest,
  type ImageLocation,
  type MissingReason,
} from "./missing-image";
import { parseEmbed, withEmbedPath, type EmbedTarget } from "./obsidian-embed";

const embedPreviewKey = new PluginKey<RevealState>("obsidian-embed-preview");

/**
 * The src an HTML export writes for an embed's picture (data-doc-src, see
 * export/exporters.ts): relative to the document, as an ordinary image's
 * is, when the file is in the document's folder or below it - the export
 * saved beside the document then finds it, and so does a copy of the whole
 * folder. A file elsewhere in the vault keeps its full path; a "../" one
 * would break as soon as the export is moved.
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
 * "Choose image…" on a missing embed's card: the picked file is copied
 * into the image folder, as a dropped image is, and the embed names it by
 * its path from the document - which Textus and Obsidian both resolve -
 * still as `![[...]]`, alt and size kept, so it saves as written. Copied
 * even when Settings › Images uploads: an embed names a vault file, not a
 * web address. One undo step.
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
    const src = await copyToImageFolder(path, {
      docPath: () => docPath,
      settings,
    });
    const widgetPos = getPos();
    if (src === null || widgetPos === undefined) return;
    // The widget sits right after its embed (side -1).
    const node = view.state.doc.resolve(widgetPos).nodeBefore;
    if (node?.type.name !== "obsidian_embed") return;
    const source = withEmbedPath(node.textContent, src);
    view.dispatch(
      closeHistory(
        view.state.tr.replaceWith(
          widgetPos - node.nodeSize + 1,
          widgetPos - 1,
          view.state.schema.text(source),
        ),
      ),
    );
  } catch (err) {
    void showMessage(`${t.missingImageChooseFailed}\n${errorText(err)}`, {
      tone: "error",
    });
  }
}

/** The picture an image embed names, found in the document's vault by the
 *  backend. One it can't find, or can't show, gets the missing image's
 *  card (missing-image.ts). */
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
    el.append(img);
    // `path`: the file found, or - not found - where the link would be
    // beside the document, for the tooltip and the folder to show.
    const missing = (reason: MissingReason, path: string | null) => {
      const location: ImageLocation = path
        ? { kind: "local", path }
        : { kind: "other" };
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
      // The name as written stays for an export, which drops the card:
      // a page shows what it showed before the card.
      const name = document.createElement("span");
      name.className = "image-missing-name";
      name.textContent = embed.path;
      el.classList.add(MISSING_IMAGE_CLASS);
      el.replaceChildren(name, card);
    };
    fs.resolveVaultImage(docPath, embed.path)
      .then((file) => {
        if (!file) return missing("notInVault", localPath(embed.path, docPath));
        img.addEventListener("error", () => missing("unsupported", file));
        showDocImage(img, file, docPath);
        img.dataset.docSrc = exportSrc(file, docPath);
      })
      .catch(() => missing("failed", null));
    caretToSourceOnClick(el, view, getPos, isMissingCardAction);
    return el;
  };
}

interface EmbedPreviewOptions {
  docPath: () => string | null;
  settings: () => Settings;
}

function buildDecorations(
  state: EditorState,
  options: EmbedPreviewOptions,
): RevealState {
  const docPath = options.docPath();
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
        Decoration.widget(to, embedWidget(embed, docPath, options.settings), {
          side: -1,
          key: `${docPath}\n${node.textContent}`,
          // The card's buttons are the card's; the editor leaves them be.
          stopEvent: isMissingCardAction,
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
export function createObsidianEmbedPreviewPlugin(options: EmbedPreviewOptions) {
  return $prose(
    () =>
      new Plugin<RevealState>({
        key: embedPreviewKey,
        state: {
          init: (_config, state) => buildDecorations(state, options),
          apply: (tr, prev, oldState, newState) =>
            applyReveal(tr, prev, oldState, newState, (state) =>
              buildDecorations(state, options),
            ),
        },
        props: {
          decorations: (state) => embedPreviewKey.getState(state)?.set,
        },
      }),
  );
}
