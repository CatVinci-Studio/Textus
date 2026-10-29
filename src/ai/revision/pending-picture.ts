import {
  shownImageFailure,
  generatedImageId,
  generatedImageSize,
  generatedImageUrl,
  generatedImagePrompt,
  loadedImageId,
  loadGeneratedImage,
  redrawGeneratedImage,
  retryGeneratedImage,
} from "./generated-images";
import { currentStrings } from "../../i18n/current";
import { showPrompt } from "../../ui/app-dialog";
import { enter } from "../../ui/moves";
import "./pending-picture.css";

/** A picture still being made in a proposal: a moving frame in its place,
 *  then the picture, or why it wasn't made. */

// One shared phase, so a frame re-created as text streams in doesn't restart.
const SHEEN_MS = 2400;

/** The frame for picture `id`, its alt text the label. */
function frame(id: string, alt: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "pending-picture";
  el.dataset.generatedId = id;
  el.setAttribute("role", "img");
  el.setAttribute("aria-busy", "true");
  el.setAttribute("aria-label", alt);
  const size = generatedImageSize(id);
  if (size && size.width > 0 && size.height > 0)
    el.style.aspectRatio = `${size.width} / ${size.height}`;
  el.style.setProperty(
    "--pending-picture-phase",
    `-${Date.now() % SHEEN_MS}ms`,
  );
  for (let i = 0; i < 3; i++) {
    const blob = document.createElement("span");
    blob.className = "pending-picture-blob";
    el.append(blob);
  }
  return el;
}

/** The frame, the picture having come: the picture; or why not. */
function settle(el: HTMLElement, id: string, alt: string, made: boolean) {
  if (!el.isConnected) return;
  const url = made ? generatedImageUrl(id) : null;
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = alt;
    // Swapped in only once decoded, or it would stand blank meanwhile.
    const made = madePicture(img, id, alt);
    void img
      .decode()
      .catch(() => undefined)
      .then(() => {
        if (!el.isConnected) return;
        el.replaceWith(made);
        enter(made, { from: "none" });
      });
    return;
  }
  el.classList.add("pending-picture-failed");
  el.removeAttribute("aria-busy");
  el.replaceChildren();
  const why = document.createElement("span");
  why.className = "pending-picture-why";
  why.textContent = shownImageFailure(id) ?? "";
  // This picture alone is asked for again; the frame paints meanwhile.
  const retry = button(
    "pending-picture-retry",
    currentStrings().agentRetry,
    () => {
      const again = frame(id, alt);
      el.replaceWith(again);
      void retryGeneratedImage(id).then((made) => settle(again, id, alt, made));
    },
  );
  el.append(why, retry);
}

/** A button in the picture's frame that keeps the editor's selection. */
function button(className: string, label: string, onClick: () => void) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = label;
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return b;
}

/** A made picture, with Redraw… over it: its description, changed by the
 *  writer, draws it again - this picture alone, the frame painting
 *  meanwhile. */
function madePicture(
  img: HTMLImageElement,
  id: string,
  alt: string,
): HTMLElement {
  const box = document.createElement("span");
  box.className = "pending-picture-made";
  const t = currentStrings();
  const redraw = button("pending-picture-redraw", t.pictureRedraw, () => {
    void (async () => {
      const before = await generatedImagePrompt(id);
      if (before === null) return;
      const prompt = (
        await showPrompt(t.pictureRedrawPrompt, before, {
          title: t.pictureRedrawTitle,
          okLabel: t.pictureRedrawOk,
          cancelLabel: t.cancel,
        })
      )?.trim();
      if (!prompt || prompt === before.trim() || !box.isConnected) return;
      const again = frame(id, alt);
      box.replaceWith(again);
      const made = await redrawGeneratedImage(id, prompt);
      settle(again, id, alt, made);
    })();
  });
  box.append(img, redraw);
  return box;
}

/** Within `root`, each picture not here yet becomes its frame, and each
 *  frame its picture once that comes. */
export function framePendingPictures(root: HTMLElement): void {
  for (const img of root.querySelectorAll<HTMLImageElement>("img")) {
    const src = img.getAttribute("src") ?? "";
    // Here already: the picture itself, to redraw.
    const here = loadedImageId(src);
    if (here) {
      img.replaceWith(
        madePicture(img.cloneNode() as HTMLImageElement, here, img.alt),
      );
      continue;
    }
    const id = generatedImageId(src);
    if (!id) continue;
    const alt = img.getAttribute("alt") ?? "";
    const el = frame(id, alt);
    img.replaceWith(el);
    void loadGeneratedImage(id).then((made) => settle(el, id, alt, made));
  }
}
