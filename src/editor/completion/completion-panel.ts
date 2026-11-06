import { clampLeft, opensBelow } from "../../ui/placement";
import "./completion-panel.css";
import type { PanelRow } from "./panel-rows";

/** On the page while the panel is open, so a formula's preview steps aside. */
const OPEN_CLASS = "completion-open";
/** The panel's icons (completion-panel.css); other names show none. */
const ICONS = new Set([
  "file",
  "link",
  "tag",
  "calendar",
  "clock",
  "star",
  "heading",
  "block",
  "quote",
  "emoji",
]);

/** A plugin's SVG as the icon's mask: drawn in the text colour, and as an
 *  image nothing in it runs. */
const svgMask = (svg: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

function iconOf(icon: string | undefined): HTMLElement {
  const el = document.createElement("span");
  el.className = "completion-icon";
  el.setAttribute("aria-hidden", "true");
  if (!icon) return el;
  if (ICONS.has(icon)) el.dataset.icon = icon;
  else if (icon.trimStart().startsWith("<svg")) {
    el.dataset.icon = "svg";
    el.style.setProperty("--icon", svgMask(icon));
  } else if ([...icon].length <= 2) {
    // The core's emoji: the character it puts in.
    el.dataset.icon = "glyph";
    el.textContent = icon;
  }
  return el;
}

/**
 * The `/` panel: every list typed for, grouped by where it comes from. It
 * keeps its place, width and row height while open - only its rows change -
 * and the editor keeps the focus; a click takes a row.
 */
export class CompletionPanel {
  private el: HTMLElement | null = null;
  private open = false;

  /** Rows with a heading, the "…" of lists still coming, the chosen row
   *  (an index into `rows`, or -1). Placed only when it opens. */
  show(
    rows: readonly PanelRow[],
    chosen: number,
    at: () => { left: number; top: number; bottom: number },
    take: (row: number) => void,
  ): void {
    const el = (this.el ??= this.create());
    el.replaceChildren(...rows.map((row, i) => this.row(row, i, take)));
    this.choose(chosen);
    if (this.open) return;
    this.open = true;
    el.hidden = false;
    document.documentElement.classList.add(OPEN_CLASS);
    this.place(el, at());
  }

  choose(index: number): void {
    const el = this.el;
    if (!el) return;
    const rows = el.children;
    for (let i = 0; i < rows.length; i++)
      if (rows[i].getAttribute("role") === "option")
        rows[i].setAttribute("aria-selected", String(i === index));
    if (index >= 0) {
      el.setAttribute("aria-activedescendant", `completion-item-${index}`);
      rows[index]?.scrollIntoView?.({ block: "nearest" });
    } else el.removeAttribute("aria-activedescendant");
  }

  isOpen(): boolean {
    return this.open;
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    if (this.el) this.el.hidden = true;
    document.documentElement.classList.remove(OPEN_CLASS);
  }

  destroy(): void {
    this.hide();
    this.el?.remove();
    this.el = null;
  }

  private row(row: PanelRow, i: number, take: (row: number) => void) {
    const el = document.createElement("div");
    if (row.kind === "heading") {
      el.className = "completion-group";
      el.setAttribute("role", "presentation");
      el.textContent = row.title;
      return el;
    }
    if (row.kind === "loading") {
      el.className = "completion-loading";
      el.setAttribute("role", "presentation");
      el.textContent = "…";
      return el;
    }
    el.className = "completion-item";
    el.setAttribute("role", "option");
    el.id = `completion-item-${i}`;
    const label = document.createElement("span");
    label.className = "completion-label";
    label.textContent = row.item.label;
    el.append(iconOf(row.item.icon), label);
    if (row.item.detail) {
      const detail = document.createElement("span");
      detail.className = "completion-detail";
      detail.textContent = row.item.detail;
      el.append(detail);
    }
    // mousedown, not click: the editor must not lose the caret first.
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      take(i);
    });
    return el;
  }

  /** Under the match, or above it where the window ends - decided once, so
   *  the panel never jumps while it is open. It grows away from the caret. */
  private place(
    el: HTMLElement,
    at: { left: number; top: number; bottom: number },
  ) {
    const tall = parseFloat(getComputedStyle(el).maxHeight) || 0;
    el.style.left = `${clampLeft(at.left, el.offsetWidth)}px`;
    if (opensBelow(at, tall, 4)) {
      el.style.top = `${at.bottom + 4}px`;
      el.style.bottom = "";
    } else {
      el.style.top = "";
      el.style.bottom = `${window.innerHeight - at.top + 4}px`;
    }
  }

  private create(): HTMLElement {
    const el = document.createElement("div");
    el.className = "completion-list floating-surface";
    el.setAttribute("role", "listbox");
    el.hidden = true;
    document.body.append(el);
    return el;
  }
}
