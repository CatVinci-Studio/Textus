import type { EditorView } from "@milkdown/kit/prose/view";
import { showDocImage } from "../../editor/images/image-plugin";
import { imageSource } from "../../editor/images/image-source";
import {
  imageDisplayName,
  imageLocation,
  missingImageCard,
  probeMissing,
} from "../../editor/images/missing-image";
import { currentStrings } from "../../i18n/current";

/** A proposal's own pictures (`![alt](images/fig.png)` in its new text)
 *  shown as the document shows them: found beside the document, and one
 *  that isn't there the document's own missing-picture card. Rendered as
 *  written, a relative src was looked up beside the app instead and showed
 *  the webview's broken-image box (1.4.7). */

const docPaths = new WeakMap<EditorView, () => string | null>();

/** Where `view`'s document is, for its proposals' pictures. */
export function setProposalDocPath(
  view: EditorView,
  docPath: () => string | null,
): void {
  docPaths.set(view, docPath);
}

export function proposalDocPath(view: EditorView | null | undefined) {
  return (view && docPaths.get(view)?.()) ?? null;
}

/** Each widget's pictures as last shown, by place and src: the typewriter
 *  renders the text anew each frame, and a new `<img>` would load again -
 *  a missing one flickering between the broken box and its card, asking
 *  the disk each time. Only the last frame's, so a file put there since is
 *  looked for again with the next proposal. */
const shownBySpan = new WeakMap<HTMLElement, Map<string, HTMLElement>>();

/** Within `root`, each picture of the document's files pointed at its file,
 *  and the missing-picture card in place of one that won't load. */
export function showProposalPictures(
  root: HTMLElement,
  docPath: string | null,
): void {
  const before = shownBySpan.get(root);
  const shown = new Map<string, HTMLElement>();
  shownBySpan.set(root, shown);
  const seen = new Map<string, number>();
  for (const img of root.querySelectorAll<HTMLImageElement>("img")) {
    const src = img.getAttribute("src") ?? "";
    const kind = imageSource(src, docPath).kind;
    if (kind !== "file" && kind !== "scoped" && kind !== "unsaved") continue;
    // The same picture twice is two places.
    const n = seen.get(src) ?? 0;
    seen.set(src, n + 1);
    const key = `${n}\n${docPath ?? ""}\n${src}`;
    const kept = before?.get(key);
    if (kept) {
      img.replaceWith(kept);
      shown.set(key, kept);
      continue;
    }
    shown.set(key, img);
    const alt = img.getAttribute("alt") ?? "";
    const missing = () => {
      const location = imageLocation(src, docPath);
      void probeMissing(location).then((reason) => {
        const card = missingImageCard(
          { name: imageDisplayName(src), alt, reason, location },
          currentStrings(),
        );
        // Shown since in a later frame, the card is that frame's too.
        const now = shownBySpan.get(root);
        if (now?.get(key) === img) now.set(key, card);
        if (img.isConnected) img.replaceWith(card);
      });
    };
    img.addEventListener("error", missing, { once: true });
    if (kind === "unsaved") {
      queueMicrotask(missing);
      continue;
    }
    showDocImage(img, src, docPath);
    // A proposal is read where it stands: its few pictures load at once, so
    // one that isn't there is its card before the writer gets to it.
    img.loading = "eager";
  }
}
