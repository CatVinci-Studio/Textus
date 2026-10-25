import type { CompletionItem } from "../../plugins/completion-sources";
import "./completion-list.css";

/** The list of completions under the caret (completion-plugin.ts): one
 *  element in the body, filled again for each list, the chosen item lit.
 *  The editor keeps the focus; a click takes an item. */
export class CompletionList {
  private el: HTMLElement | null = null;
  private chosen = 0;
  private count = 0;

  show(
    items: CompletionItem[],
    at: { left: number; top: number },
    take: (index: number) => void,
  ): void {
    const el = (this.el ??= this.create());
    el.replaceChildren(
      ...items.map((item, i) => {
        const row = document.createElement("div");
        row.className = "completion-item";
        row.setAttribute("role", "option");
        row.id = `completion-item-${i}`;
        const label = document.createElement("span");
        label.className = "completion-label";
        label.textContent = item.label;
        row.append(label);
        if (item.detail) {
          const detail = document.createElement("span");
          detail.className = "completion-detail";
          detail.textContent = item.detail;
          row.append(detail);
        }
        // mousedown, not click: the editor must not lose the caret first.
        row.addEventListener("mousedown", (event) => {
          event.preventDefault();
          take(i);
        });
        return row;
      }),
    );
    this.count = items.length;
    this.choose(0);
    el.hidden = false;
    // Under the caret, or above it where the window ends.
    const margin = 8;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const left = Math.min(at.left, window.innerWidth - width - margin);
    const below = at.top + 4;
    el.style.left = `${Math.max(margin, left)}px`;
    el.style.top = `${below + height > window.innerHeight - margin ? at.top - height - 24 : below}px`;
  }

  move(by: number): void {
    if (this.count > 0)
      this.choose((this.chosen + by + this.count) % this.count);
  }

  index(): number {
    return this.chosen;
  }

  hide(): void {
    if (this.el) this.el.hidden = true;
  }

  destroy(): void {
    this.el?.remove();
    this.el = null;
  }

  private choose(index: number): void {
    this.chosen = index;
    const rows = this.el?.children ?? [];
    for (let i = 0; i < rows.length; i++)
      rows[i].setAttribute("aria-selected", String(i === index));
    rows[index]?.scrollIntoView({ block: "nearest" });
    this.el?.setAttribute("aria-activedescendant", `completion-item-${index}`);
  }

  private create(): HTMLElement {
    const el = document.createElement("div");
    el.className = "completion-list";
    el.setAttribute("role", "listbox");
    el.hidden = true;
    document.body.append(el);
    return el;
  }
}
