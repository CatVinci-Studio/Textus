import "./image-viewer.css";

/**
 * Full-window image preview: wheel / pinch to zoom around the pointer, drag
 * to pan, double-click to toggle 1× and 2×, quarter turns, and - for images
 * Textus generated - the prompt they came from, with a copy button. Plain
 * DOM so the editor's node view can open it without React.
 */
export interface ImageViewerLabels {
  zoomIn: string;
  zoomOut: string;
  rotateLeft: string;
  rotateRight: string;
  close: string;
  prompt: string;
  promptMissing: string;
  copyPrompt: string;
  copied: string;
}

export interface ImagePromptDetails {
  prompt: string;
  model: string | null;
  width: number | null;
  height: number | null;
}

export interface ImageViewerOptions {
  src: string;
  alt: string;
  rotate: number;
  labels: ImageViewerLabels;
  /** Generated images: resolves their prompt (null when there is none). */
  loadPrompt?: () => Promise<ImagePromptDetails | null>;
  /** Open with the prompt panel showing. */
  showPrompt?: boolean;
  /** Persist a quarter turn on the document's image. */
  onRotate?: (quarterTurns: number) => void;
}

let open: (() => void) | null = null;

const ICONS = {
  zoomOut: '<path d="M5 12h14"/>',
  zoomIn: '<path d="M12 5v14M5 12h14"/>',
  rotateLeft: '<path d="M4 4v6h6"/><path d="M4.5 15a8 8 0 1 0 2-8.5L4 10"/>',
  rotateRight:
    '<path d="M20 4v6h-6"/><path d="M19.5 15a8 8 0 1 1-2-8.5L20 10"/>',
  prompt: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};

function iconButton(
  icon: keyof typeof ICONS,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "image-viewer-button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

export function openImageViewer(options: ImageViewerOptions): () => void {
  open?.();
  const { labels } = options;
  const previousFocus = document.activeElement as HTMLElement | null;
  const root = document.createElement("div");
  root.className = "image-viewer";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", options.alt || labels.prompt);
  root.tabIndex = -1;

  const stage = document.createElement("div");
  stage.className = "image-viewer-stage";
  const img = document.createElement("img");
  img.src = options.src;
  img.alt = options.alt;
  img.draggable = false;
  stage.append(img);

  const toolbar = document.createElement("div");
  toolbar.className = "image-viewer-toolbar";
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "image-viewer-zoom";

  const panel = document.createElement("aside");
  panel.className = "image-viewer-prompt";
  panel.hidden = true;

  let scale = 1;
  let x = 0;
  let y = 0;
  let rotate = options.rotate;
  const render = () => {
    img.style.transform = `translate(${x}px, ${y}px) scale(${scale}) rotate(${rotate}deg)`;
    // A quarter turn swaps which side the window limits.
    stage.classList.toggle("is-turned", Math.abs(rotate / 90) % 2 === 1);
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  };
  const zoomAt = (next: number, cx: number, cy: number) => {
    const bounded = Math.min(8, Math.max(0.2, next));
    const rect = stage.getBoundingClientRect();
    // Keep the point under the pointer where it is.
    const px = cx - rect.left - rect.width / 2 - x;
    const py = cy - rect.top - rect.height / 2 - y;
    x -= px * (bounded / scale - 1);
    y -= py * (bounded / scale - 1);
    scale = bounded;
    if (scale <= 1) {
      x = 0;
      y = 0;
    }
    render();
  };
  const center = () => {
    const rect = stage.getBoundingClientRect();
    return [rect.left + rect.width / 2, rect.top + rect.height / 2] as const;
  };
  const turn = (quarterTurns: number) => {
    rotate += quarterTurns * 90;
    render();
    options.onRotate?.(quarterTurns);
  };

  let promptLoaded = false;
  const showPromptPanel = async () => {
    if (promptLoaded) {
      panel.hidden = !panel.hidden;
      return;
    }
    panel.hidden = false;
    promptLoaded = true;
    panel.textContent = "…";
    const details = (await options.loadPrompt?.().catch(() => null)) ?? null;
    panel.textContent = "";
    const heading = document.createElement("strong");
    heading.textContent = labels.prompt;
    panel.append(heading);
    if (!details) {
      const missing = document.createElement("p");
      missing.textContent = labels.promptMissing;
      panel.append(missing);
      return;
    }
    const text = document.createElement("p");
    text.className = "image-viewer-prompt-text";
    text.textContent = details.prompt;
    const meta = document.createElement("span");
    meta.className = "image-viewer-prompt-meta";
    meta.textContent = [
      details.model,
      details.width && details.height
        ? `${details.width}×${details.height}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "image-viewer-copy";
    copy.textContent = labels.copyPrompt;
    copy.addEventListener("click", (event) => {
      event.stopPropagation();
      void navigator.clipboard.writeText(details.prompt).then(() => {
        copy.textContent = labels.copied;
        setTimeout(() => (copy.textContent = labels.copyPrompt), 1600);
      });
    });
    panel.append(text, meta, copy);
  };

  toolbar.append(
    iconButton("zoomOut", labels.zoomOut, () =>
      zoomAt(scale / 1.25, ...center()),
    ),
    zoomLabel,
    iconButton("zoomIn", labels.zoomIn, () =>
      zoomAt(scale * 1.25, ...center()),
    ),
    iconButton("rotateLeft", labels.rotateLeft, () => turn(-1)),
    iconButton("rotateRight", labels.rotateRight, () => turn(1)),
    ...(options.loadPrompt
      ? [iconButton("prompt", labels.prompt, () => void showPromptPanel())]
      : []),
    iconButton("close", labels.close, () => close()),
  );
  root.append(stage, toolbar, panel);

  stage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      // Trackpad pinch arrives as ctrl+wheel with small deltas.
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002));
      zoomAt(scale * factor, event.clientX, event.clientY);
    },
    { passive: false },
  );
  let drag: {
    id: number;
    sx: number;
    sy: number;
    x: number;
    y: number;
  } | null = null;
  let moved = false;
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, sx: event.clientX, sy: event.clientY, x, y };
    moved = false;
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("is-dragging");
  });
  stage.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.sx;
    const dy = event.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    x = drag.x + dx;
    y = drag.y + dy;
    render();
  });
  const endDrag = () => {
    drag = null;
    stage.classList.remove("is-dragging");
  };
  stage.addEventListener("pointerup", (event) => {
    endDrag();
    // A click on the backdrop (not the picture) closes, unless it panned.
    if (!moved && event.target === stage && scale <= 1) close();
  });
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("dblclick", (event) => {
    zoomAt(scale > 1.05 ? 1 : 2, event.clientX, event.clientY);
  });
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "+" || event.key === "=")
      zoomAt(scale * 1.25, ...center());
    else if (event.key === "-") zoomAt(scale / 1.25, ...center());
    else if (event.key === "0") zoomAt(1, ...center());
  };
  window.addEventListener("keydown", keydown, true);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    open = null;
    window.removeEventListener("keydown", keydown, true);
    root.dataset.state = "closing";
    root.inert = true;
    previousFocus?.focus?.({ preventScroll: true });
    const remove = () => root.remove();
    root.addEventListener("animationend", remove, { once: true });
    // Never wait for an animation that does not run (reduced motion).
    setTimeout(remove, 400);
  };
  open = close;
  render();
  document.body.append(root);
  root.focus({ preventScroll: true });
  if (options.showPrompt && options.loadPrompt) void showPromptPanel();
  return close;
}
