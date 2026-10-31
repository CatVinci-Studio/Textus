import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView, NodeView } from "@milkdown/kit/prose/view";
import type { RemarkPluginRaw } from "@milkdown/kit/transformer";
import { $nodeSchema, $prose, $remark } from "@milkdown/kit/utils";
import { unfoldRange } from "../html/details-fold";
import { revealPosition } from "../reveal-position";
import { touchesHeading } from "./heading-id-plugin";

// `[TOC]` alone on a line, any case, as Typora writes it.
const TOC_RE = /^\[toc\]$/i;

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
}

/** A top-level paragraph that says only `[TOC]` becomes a `toc` node,
 *  keeping how it was written. */
const remarkToc: RemarkPluginRaw<unknown> = () => (tree) => {
  const root = tree as MdastNode;
  root.children?.forEach((child, index, children) => {
    const only = child.children?.length === 1 ? child.children[0] : undefined;
    if (
      child.type === "paragraph" &&
      only?.type === "text" &&
      TOC_RE.test(only.value ?? "")
    )
      children[index] = { type: "toc", value: only.value };
  });
};

export const remarkTocPlugin = $remark("remark-toc", () => remarkToc);

export const tocSchema = $nodeSchema("toc", () => ({
  group: "block",
  atom: true,
  selectable: true,
  attrs: { source: { default: "[TOC]" } },
  parseDOM: [
    {
      tag: 'nav[data-type="toc"]',
      getAttrs: (dom) => ({
        source: (dom as HTMLElement).dataset.source ?? "[TOC]",
      }),
    },
  ],
  toDOM: (node) => [
    "nav",
    { "data-type": "toc", "data-source": node.attrs.source, class: "md-toc" },
  ],
  parseMarkdown: {
    match: (node) => node.type === "toc",
    runner: (state, node, type) => {
      state.addNode(type, { source: node.value as string });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "toc",
    // `html` goes out verbatim: a text node would be escaped to `\[TOC]`.
    runner: (state, node) => {
      state.addNode("html", undefined, node.attrs.source as string);
    },
  },
}));

export interface TocEntry {
  level: number;
  text: string;
  id: string;
}

/** The document's non-empty headings in order, as the TOC lists them. */
export function tocEntries(doc: ProseNode): TocEntry[] {
  const entries: TocEntry[] = [];
  doc.descendants((node) => {
    if (node.type.name !== "heading") return !node.isTextblock;
    const text = node.textContent.trim();
    if (text)
      entries.push({
        level: node.attrs.level as number,
        text,
        id: (node.attrs.id as string) ?? "",
      });
    return false;
  });
  return entries;
}

/** Where the `index`-th listed heading's text starts, or null. */
export function tocEntryPos(doc: ProseNode, index: number): number | null {
  let seen = 0;
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name !== "heading") return !node.isTextblock;
    if (node.textContent.trim() && seen++ === index) found = pos + 1;
    return false;
  });
  return found;
}

export interface TocStrings {
  label: string;
  empty: string;
}

// Each editor's TOCs on screen, redrawn together when the headings change.
const liveTocs = new WeakMap<EditorView, Set<TocView>>();

class TocView implements NodeView {
  dom: HTMLElement;
  private drawn = "";

  constructor(
    private readonly view: EditorView,
    private readonly strings: () => TocStrings,
  ) {
    this.dom = document.createElement("nav");
    this.dom.className = "md-toc";
    this.dom.dataset.type = "toc";
    this.dom.contentEditable = "false";
    this.dom.addEventListener("mousedown", this.onMouseDown);
    this.dom.addEventListener("click", this.onClick);
    let views = liveTocs.get(view);
    if (!views) liveTocs.set(view, (views = new Set()));
    views.add(this);
    this.draw();
  }

  /** Writes the list only when what it says changed. */
  draw() {
    const entries = tocEntries(this.view.state.doc);
    const { label, empty } = this.strings();
    const key = JSON.stringify([label, empty, entries]);
    if (key === this.drawn) return;
    this.drawn = key;
    this.dom.setAttribute("aria-label", label);
    if (entries.length === 0) {
      const note = document.createElement("p");
      note.className = "md-toc-empty";
      note.textContent = empty;
      this.dom.replaceChildren(note);
      return;
    }
    // Indented from the shallowest heading, so a document without an H1
    // doesn't start one step in.
    const top = Math.min(...entries.map((entry) => entry.level));
    // Typora's markup and class names, which its themes style; not a list,
    // which the editor's and the themes' bullets would mark.
    const list = document.createElement("div");
    list.className = "md-toc-content";
    list.setAttribute("role", "list");
    entries.forEach((entry, index) => {
      const item = document.createElement("div");
      item.className = `md-toc-item md-toc-h${entry.level}`;
      item.setAttribute("role", "listitem");
      item.style.setProperty("--md-toc-depth", String(entry.level - top));
      const link = document.createElement("a");
      link.className = "md-toc-inner";
      // The heading's own id: the anchor works in an exported page too.
      if (entry.id) link.href = `#${entry.id}`;
      link.dataset.index = String(index);
      link.textContent = entry.text;
      item.append(link);
      list.append(item);
    });
    this.dom.replaceChildren(list);
  }

  private onMouseDown = (event: MouseEvent) => {
    const link = (event.target as Element).closest?.("a[data-index]");
    if (!(link instanceof HTMLElement) || event.button !== 0) return;
    event.preventDefault();
    const pos = tocEntryPos(this.view.state.doc, Number(link.dataset.index));
    if (pos === null) return;
    // A heading in a folded <details> has no place on screen until it opens.
    unfoldRange(this.view, pos);
    this.view.dispatch(
      this.view.state.tr.setSelection(
        TextSelection.create(this.view.state.doc, pos),
      ),
    );
    revealPosition(this.view, pos);
    this.view.focus();
  };

  // The jump is the mousedown's: the link's href is for an exported page.
  private onClick = (event: MouseEvent) => {
    if ((event.target as Element).closest?.("a[data-index]"))
      event.preventDefault();
  };

  // A click on a link is the TOC's; anywhere else selects the block.
  stopEvent(event: Event) {
    return !!(event.target as Element).closest?.("a[data-index]");
  }

  ignoreMutation() {
    return true;
  }

  update(node: ProseNode) {
    return node.type.name === "toc";
  }

  destroy() {
    this.dom.removeEventListener("mousedown", this.onMouseDown);
    this.dom.removeEventListener("click", this.onClick);
    liveTocs.get(this.view)?.delete(this);
  }
}

const tocKey = new PluginKey<number>("toc");

// How long editing a heading rests before the TOC follows, as heading ids do.
const REDRAW_DELAY_MS = 300;

/** Enter at the end of a top-level paragraph that says `[TOC]` makes it a
 *  TOC, as Typora does, with a paragraph after it to go on in. */
function enterMakesToc(view: EditorView): boolean {
  const { state } = view;
  const { $from, empty } = state.selection;
  const toc = state.schema.nodes.toc;
  if (!toc || !empty || $from.depth !== 1) return false;
  const block = $from.parent;
  if (
    block.type.name !== "paragraph" ||
    $from.parentOffset !== block.content.size
  )
    return false;
  const text = block.textContent;
  if (!TOC_RE.test(text) || block.childCount !== 1) return false;
  const from = $from.before(1);
  const tr = state.tr.replaceWith(from, $from.after(1), [
    toc.create({ source: text }),
    state.schema.nodes.paragraph!.create(),
  ]);
  const after = from + 1 + 1;
  tr.setSelection(TextSelection.create(tr.doc, after));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * The TOC's node view and its Enter. TOCs redraw only after a change to a
 * heading, once editing rests, and not at all in a document without one.
 */
export const createTocPlugin = (strings: () => TocStrings) =>
  $prose(
    () =>
      new Plugin<number>({
        key: tocKey,
        state: {
          init: () => 0,
          apply: (tr, count) =>
            tr.docChanged && touchesHeading(tr) ? count + 1 : count,
        },
        props: {
          nodeViews: {
            toc: (_node, view) => new TocView(view, strings),
          },
          handleKeyDown(view, event) {
            if (
              event.key !== "Enter" ||
              event.shiftKey ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.isComposing ||
              view.composing
            )
              return false;
            return enterMakesToc(view);
          },
        },
        view: (view) => {
          let drawn = tocKey.getState(view.state);
          let timer: ReturnType<typeof setTimeout> | undefined;
          return {
            update: (view) => {
              const count = tocKey.getState(view.state);
              if (count === drawn || !liveTocs.get(view)?.size) return;
              clearTimeout(timer);
              timer = setTimeout(() => {
                if (view.isDestroyed) return;
                drawn = tocKey.getState(view.state);
                liveTocs.get(view)?.forEach((toc) => toc.draw());
              }, REDRAW_DELAY_MS);
            },
            destroy: () => clearTimeout(timer),
          };
        },
      }),
  );
