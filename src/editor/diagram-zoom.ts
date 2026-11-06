import { currentStrings } from "../i18n/current";
import { motionAllowed } from "../ui/motion";
import "./diagram-zoom.css";

/** How far a diagram can be zoomed out and in. */
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;

/** The zoom a wheel notch gives; a trackpad pinch takes the same rule per
 *  pixel. */
export function nextScale(scale: number, deltaY: number): number {
  return clampScale(scale * Math.exp(-deltaY * 0.0015));
}

export const clampScale = (scale: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** WebKit's pinch: the zoom since the fingers went down, and where. */
interface PinchEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

const ARROW_STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

/** Pictures to page through with ← and →, the one shown at `at`; each a
 *  URL, or one still loading. */
export interface PictureSet {
  pictures: (string | Promise<string | null>)[];
  at: number;
}

/**
 * A diagram's drawing, or a picture, in a zoomable, draggable viewer over
 * the window. It shows a copy: nothing here touches the document.
 */
export function openDiagramViewer(
  source: SVGSVGElement | HTMLImageElement,
  frame: HTMLElement,
  set?: PictureSet,
): () => void {
  const t = currentStrings();
  const picture = source instanceof HTMLImageElement;
  const layer = document.createElement("div");
  layer.className = "diagram-viewer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute(
    "aria-label",
    picture ? t.pictureViewerLabel : t.diagramViewerLabel,
  );
  const stage = document.createElement("div");
  stage.className = "diagram-viewer-stage";
  const drawing = source.cloneNode(true) as SVGSVGElement | HTMLImageElement;
  drawing.removeAttribute("style");
  if (drawing instanceof HTMLImageElement) drawing.draggable = false;
  drawing.classList.add("diagram-viewer-drawing");
  stage.append(drawing);
  // A Pele drawing takes its colours from its frame's variables, Mermaid's
  // from its own style.
  const look = getComputedStyle(frame);
  for (const name of ["color", "background-color"])
    stage.style.setProperty(name, look.getPropertyValue(name));
  for (const name of Array.from(look))
    if (name.startsWith("--pele-"))
      stage.style.setProperty(name, look.getPropertyValue(name));
  const close = document.createElement("button");
  close.type = "button";
  close.className = "diagram-viewer-close";
  close.setAttribute("aria-label", t.diagramViewerClose);
  close.textContent = "×";
  const hint = document.createElement("div");
  hint.className = "diagram-viewer-hint";
  hint.textContent = t.diagramViewerHint;
  layer.append(stage, close, hint);
  const turn = set && set.pictures.length > 1 ? pager(set) : null;

  let scale = 1;
  let x = 0;
  let y = 0;
  const apply = () => {
    drawing.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };
  const fit = () => {
    // A picture at its own size, a drawing at the size it is drawn.
    const box =
      drawing instanceof HTMLImageElement
        ? { width: drawing.naturalWidth, height: drawing.naturalHeight }
        : source.getBoundingClientRect();
    const room = stage.getBoundingClientRect();
    // A picture opens no larger than it is: stretched, it blurs.
    scale = Math.min(
      picture ? 1 : MAX_SCALE,
      Math.max(
        MIN_SCALE,
        Math.min(
          (room.width * 0.9) / Math.max(box.width, 1),
          (room.height * 0.9) / Math.max(box.height, 1),
        ),
      ),
    );
    drawing.style.width = `${box.width}px`;
    drawing.style.height = `${box.height}px`;
    x = (room.width - box.width * scale) / 2;
    y = (room.height - box.height * scale) / 2;
    apply();
  };

  /** Zooms to `next`, the point under the pointer staying under it. */
  const zoomAt = (clientX: number, clientY: number, next: number) => {
    const room = stage.getBoundingClientRect();
    const px = clientX - room.left;
    const py = clientY - room.top;
    x = px - ((px - x) * next) / scale;
    y = py - ((py - y) * next) / scale;
    scale = next;
    apply();
  };
  // The scale a WebKit pinch started from, while it lasts.
  let pinchFrom: number | null = null;

  // Over the whole layer, and no further: a pinch is a wheel event in
  // Chromium, and the window's own zoom would take it too.
  layer.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      // WebKit's pinch comes as gestures below; its wheel twin is skipped.
      if (pinchFrom !== null && event.ctrlKey) return;
      zoomAt(event.clientX, event.clientY, nextScale(scale, event.deltaY));
    },
    { passive: false },
  );
  let drag: { x: number; y: number } | null = null;
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { x: event.clientX - x, y: event.clientY - y };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("diagram-viewer-dragging");
  });
  stage.addEventListener("pointermove", (event) => {
    if (!drag) return;
    x = event.clientX - drag.x;
    y = event.clientY - drag.y;
    apply();
  });
  const endDrag = () => {
    drag = null;
    stage.classList.remove("diagram-viewer-dragging");
  };
  // WebKit's pinch zooms the picture, never the window.
  for (const type of ["gesturestart", "gesturechange", "gestureend"])
    layer.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pinch = event as PinchEvent;
      if (type === "gesturestart") pinchFrom = scale;
      else if (type === "gestureend") pinchFrom = null;
      else if (pinchFrom !== null && Number.isFinite(pinch.scale))
        zoomAt(
          pinch.clientX,
          pinch.clientY,
          clampScale(pinchFrom * pinch.scale),
        );
    });
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("dblclick", fit);

  const previous = document.activeElement as HTMLElement | null;
  const onKey = (event: KeyboardEvent) => {
    const step = turn && ARROW_STEPS[event.key];
    if (event.key !== "Escape" && !step) return;
    event.preventDefault();
    event.stopPropagation();
    if (step) turn?.(step);
    else dismiss();
  };
  let closed = false;
  function dismiss() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    const done = () => layer.remove();
    if (motionAllowed()) {
      layer.classList.add("diagram-viewer-leaving");
      layer.addEventListener("animationend", done, { once: true });
      // In case the animation never runs (a hidden window).
      setTimeout(done, 400);
    } else done();
    previous?.focus?.();
  }
  /** ‹ and › on the sides, and the hint naming the arrow keys; returns the
   *  step to the next picture or the one before. */
  function pager({ pictures, at }: PictureSet) {
    let index = at;
    const step = async (by: number) => {
      index = (index + by + pictures.length) % pictures.length;
      const want = index;
      const url = await pictures[want];
      if (!url || want !== index || !(drawing instanceof HTMLImageElement))
        return;
      drawing.src = url;
      await drawing.decode?.().catch(() => {});
      fit();
    };
    for (const [by, label, glyph] of [
      [-1, t.pictureViewerPrevious, "‹"],
      [1, t.pictureViewerNext, "›"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `diagram-viewer-turn diagram-viewer-turn-${by < 0 ? "back" : "on"}`;
      button.setAttribute("aria-label", label);
      button.textContent = glyph;
      button.addEventListener("click", () => void step(by));
      layer.append(button);
    }
    hint.textContent = `${t.diagramViewerHint} · ${t.pictureViewerTurnHint}`;
    return (by: number) => void step(by);
  }

  close.addEventListener("click", dismiss);
  layer.addEventListener("click", (event) => {
    if (event.target === layer) dismiss();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(layer);
  fit();
  close.focus();
  return dismiss;
}

/** The button in a drawn diagram's corner, or a picture's, that opens it in
 *  the viewer. A press on it isn't the frame's: that one puts the caret in
 *  the source. */
export function zoomButton(
  frame: HTMLElement,
  shown: () => SVGSVGElement | HTMLImageElement | null = () =>
    frame.querySelector<SVGSVGElement>(":scope > svg"),
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mermaid-zoom";
  const t = currentStrings();
  const label = frame.querySelector(":scope > img")
    ? t.pictureZoom
    : t.diagramZoom;
  button.setAttribute("aria-label", label);
  button.title = label;
  // Drawn by CSS, not an <svg>: the frame's one svg is the diagram, which
  // export and the editor look for.
  const icon = document.createElement("span");
  icon.className = "mermaid-zoom-icon";
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const drawing = shown();
    if (!drawing) return;
    // The page's own selection goes; the editor puts its caret back on
    // focus, so no highlight is left behind the viewer.
    getSelection()?.removeAllRanges();
    openDiagramViewer(drawing, frame);
  });
  return button;
}
