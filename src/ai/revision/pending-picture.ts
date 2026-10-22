import {
  generatedImageFailure,
  generatedImageId,
  generatedImageSize,
  generatedImageUrl,
  loadGeneratedImage,
  retryGeneratedImage,
} from "./generated-images";
import { currentStrings } from "../../i18n/current";
import "./pending-picture.css";

/**
 * A picture Textus AI is still making, in a proposal: a frame in its place
 * and shape, softly moving, until the picture comes - then the picture -
 * or, if it wasn't made, why. generate_image returns while the picture is
 * made (ai/images.rs), so the text around it, and the rest of the reply,
 * no longer wait for it. The frame's drift and sheen follow #221 by
 * Zhuohang Jiang.
 *
 * All the clocks share one phase: a frame drawn again (the proposal's
 * widget re-created as text streams in) picks up where the last one was
 * rather than starting over.
 */

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
    el.replaceWith(img);
    return;
  }
  el.classList.add("pending-picture-failed");
  el.removeAttribute("aria-busy");
  el.replaceChildren();
  const why = document.createElement("span");
  why.className = "pending-picture-why";
  why.textContent = generatedImageFailure(id) ?? "";
  // This picture alone is asked for again; the frame paints meanwhile.
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "pending-picture-retry";
  retry.textContent = currentStrings().agentRetry;
  retry.addEventListener("mousedown", (e) => e.preventDefault());
  retry.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const again = frame(id, alt);
    el.replaceWith(again);
    void retryGeneratedImage(id).then((made) => settle(again, id, alt, made));
  });
  el.append(why, retry);
}

/**
 * Within `root` (a proposal's rendered text), each picture not here yet
 * becomes its frame, and each frame its picture once that comes.
 */
export function framePendingPictures(root: HTMLElement): void {
  for (const img of root.querySelectorAll<HTMLImageElement>("img")) {
    const id = generatedImageId(img.getAttribute("src") ?? "");
    if (!id) continue;
    const alt = img.getAttribute("alt") ?? "";
    const el = frame(id, alt);
    img.replaceWith(el);
    void loadGeneratedImage(id).then((made) => settle(el, id, alt, made));
  }
}
