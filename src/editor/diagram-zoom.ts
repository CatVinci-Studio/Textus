import { currentStrings } from "../i18n/current";
import { motionAllowed } from "../ui/motion";
import "./diagram-zoom.css";

/** How far a diagram can be zoomed out and in. */
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;

/** The zoom a wheel notch gives; a trackpad pinch takes the same rule per
 *  pixel. */
export function nextScale(scale: number, deltaY: number): number {
  const factor = Math.exp(-deltaY * 0.0015);
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
}

/**
 * A diagram's drawing in a zoomable, draggable viewer over the window. The
 * drawing is a copy: nothing here touches the document.
 */
export function openDiagramViewer(
  svg: SVGSVGElement,
  frame: HTMLElement,
): () => void {
  const t = currentStrings();
  const layer = document.createElement("div");
  layer.className = "diagram-viewer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", t.diagramViewerLabel);
  const stage = document.createElement("div");
  stage.className = "diagram-viewer-stage";
  const drawing = svg.cloneNode(true) as SVGSVGElement;
  drawing.removeAttribute("style");
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

  let scale = 1;
  let x = 0;
  let y = 0;
  const apply = () => {
    drawing.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };
  const fit = () => {
    const box = svg.getBoundingClientRect();
    const room = stage.getBoundingClientRect();
    scale = Math.min(
      MAX_SCALE,
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

  stage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const room = stage.getBoundingClientRect();
      const px = event.clientX - room.left;
      const py = event.clientY - room.top;
      const next = nextScale(scale, event.deltaY);
      // The point under the pointer stays under it.
      x = px - ((px - x) * next) / scale;
      y = py - ((py - y) * next) / scale;
      scale = next;
      apply();
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
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("dblclick", fit);

  const previous = document.activeElement as HTMLElement | null;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }
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

/** The button in a drawn diagram's corner that opens it in the viewer. A
 *  press on it isn't the frame's: that one puts the caret in the source. */
export function zoomButton(frame: HTMLElement): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mermaid-zoom";
  const label = currentStrings().diagramZoom;
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
    const svg = frame.querySelector<SVGSVGElement>(":scope > svg");
    if (svg) openDiagramViewer(svg, frame);
  });
  return button;
}
