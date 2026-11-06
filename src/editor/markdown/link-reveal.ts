import { remarkCtx } from "@milkdown/kit/core";
import { Fragment, Slice } from "@milkdown/kit/prose/model";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from "@milkdown/kit/prose/state";
import { Decoration, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import {
  applyReveal,
  revealAll,
  type Reveal,
  type RevealState,
} from "../reveal-state";
import { showDocImage } from "../images/image-plugin";
import { isImeKeyEvent } from "../keys/ime";
import { labelParts, type LabelPart } from "./link-label";
import { LINK } from "./link-source";
import {
  hiddenLinkParts,
  inlinedReference,
  linkHref,
  parseLink,
} from "./link-syntax";

/**
 * A link reads as its text, as in Typora; its Markdown shows while the caret
 * is on it. The source is always in the document: only decorations change,
 * so undo, redo and input methods see ordinary text.
 */

const key = new PluginKey<RevealState>("link-reveal");

const isLink = (node: ProseNode) => node.type.name === LINK;

/** The source of every `[ref]: url` definition in `doc`. */
export function definitionsIn(doc: ProseNode): string[] {
  const found: string[] = [];
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    if (node.firstChild?.type.name === "link_definition")
      found.push(node.firstChild.textContent);
    return false;
  });
  return found;
}

/** Each label's parts, kept while it is drawn: labels repeat and rarely
 *  change. */
function cachedLabels(parse: (markdown: string) => unknown) {
  const cache = new Map<string, LabelPart[]>();
  return (label: string) => {
    let parts = cache.get(label);
    if (!parts) {
      parts = labelParts(label, parse);
      if (cache.size > 256) cache.clear();
      cache.set(label, parts);
    }
    return parts;
  };
}

function labelDecorations(
  parts: LabelPart[],
  at: number,
  docPath: () => string | null,
): Decoration[] {
  return parts.flatMap((part) => {
    const from = at + part.from;
    const to = at + part.to;
    if (part.kind === "hide")
      return [Decoration.inline(from, to, { class: "link-source-hidden" })];
    if (part.kind === "tag")
      return [Decoration.inline(from, to, { nodeName: part.tag })];
    return [
      Decoration.inline(from, to, { class: "link-source-hidden" }),
      Decoration.widget(
        from,
        () => {
          const img = document.createElement("img");
          img.alt = part.alt;
          img.className = "link-image";
          showDocImage(img, part.src, docPath());
          return img;
        },
        { key: `link-image:${part.src}`, side: -1 },
      ),
    ];
  });
}

function linkReveal(
  label: (text: string) => LabelPart[],
  docPath: () => string | null,
): Reveal {
  return {
    match: isLink,
    decorate(node, pos, touches) {
      const text = node.textContent;
      const end = pos + node.nodeSize;
      const href = linkHref(text);
      const out = href ? [Decoration.node(pos, end, { href })] : [];
      const parts = hiddenLinkParts(text);
      if (!parts) return out;
      const shown = touches(pos, end);
      for (const [from, to] of parts)
        out.push(
          Decoration.inline(pos + 1 + from, pos + 1 + to, {
            class: shown ? "link-source-syntax" : "link-source-hidden",
          }),
        );
      const link = parseLink(text)!;
      if (!shown && parts.length === 2 && parts[0][1] === link.label[0])
        out.push(
          ...labelDecorations(
            label(text.slice(...link.label)),
            pos + 1 + link.label[0],
            docPath,
          ),
        );
      return out;
    },
  };
}

/** `slice` with each reference link written out as an inline one. */
export function inlineReferences(slice: Slice, doc: ProseNode): Slice {
  const definitions = () => definitionsIn(doc);
  const map = (content: Fragment): Fragment => {
    const nodes: ProseNode[] = [];
    content.forEach((node) => {
      const inlined = isLink(node)
        ? inlinedReference(node.textContent, definitions)
        : null;
      nodes.push(
        inlined
          ? node.type.create(null, node.type.schema.text(inlined))
          : node.isText || isLink(node)
            ? node
            : node.copy(map(node.content)),
      );
    });
    return Fragment.from(nodes);
  };
  return new Slice(map(slice.content), slice.openStart, slice.openEnd);
}

/** The URL of the link at `target` in `view`, references read against the
 *  document's definitions; null off a link. */
export function linkHrefAt(
  view: EditorView,
  target: EventTarget | null,
): string | null {
  const el = (target as Element | null)?.closest?.(`[data-type="${LINK}"]`);
  if (!el || !view.dom.contains(el)) return null;
  let node: ProseNode | null;
  try {
    node = view.state.doc.nodeAt(view.posAtDOM(el, 0) - 1);
  } catch {
    return null;
  }
  if (!node || !isLink(node)) return null;
  const doc = view.state.doc;
  return linkHref(node.textContent, () => definitionsIn(doc));
}

/**
 * Where Left or Right takes a caret at an edge of a link: past the edge.
 * Just outside and just inside are one place on screen, and WebKit's own
 * step stopped at the other. Null where the browser's step is fine.
 */
export function arrowPastLinkEdge(
  state: EditorState,
  dir: 1 | -1,
): number | null {
  const { selection, doc } = state;
  if (!selection.empty) return null;
  const { $from, from } = selection;
  let start: number;
  if (isLink($from.parent)) start = $from.before();
  else if ($from.nodeAfter && isLink($from.nodeAfter)) start = from;
  else if ($from.nodeBefore && isLink($from.nodeBefore))
    start = from - $from.nodeBefore.nodeSize;
  else return null;
  const node = doc.nodeAt(start)!;
  const end = start + node.nodeSize;
  if (node.content.size === 0) return null;
  const atStart = from === start || from === start + 1;
  const atEnd = from === end || from === end - 1;
  if (dir === 1) {
    // Before the link or at its start: past its first character; at its end,
    // past the character after it.
    if (atStart) return start + 2;
    if (atEnd && doc.resolve(end).nodeAfter?.isText) return end + 1;
    return null;
  }
  if (atEnd) return end - 2;
  if (atStart && doc.resolve(start).nodeBefore?.isText) return start - 1;
  return null;
}

const PLAIN_ARROWS: Record<string, 1 | -1> = { ArrowLeft: -1, ArrowRight: 1 };

/** Enter in a link: at either end, the line breaks beside it; inside, the
 *  source is split as the text it is. */
function enterInLink(view: EditorView): void {
  const { selection } = view.state;
  const { $from } = selection;
  if (!selection.empty || !isLink($from.parent)) return;
  const node = $from.parent;
  const start = $from.before();
  const tr = view.state.tr;
  if ($from.parentOffset === 0)
    tr.setSelection(TextSelection.create(tr.doc, start));
  else if ($from.parentOffset === node.content.size)
    tr.setSelection(TextSelection.create(tr.doc, start + node.nodeSize));
  else
    tr.replaceWith(
      start,
      start + node.nodeSize,
      view.state.schema.text(node.textContent),
    ).setSelection(TextSelection.create(tr.doc, start + $from.parentOffset));
  view.dispatch(tr);
}

export function createLinkRevealPlugin(docPath: () => string | null) {
  return $prose((ctx) => {
    const reveal = linkReveal(
      cachedLabels((markdown) => ctx.get(remarkCtx).parse(markdown)),
      docPath,
    );
    return new Plugin<RevealState>({
      key,
      state: {
        init: (_config, state) => revealAll(state, reveal),
        apply: (tr, prev, oldState, newState) =>
          applyReveal(tr, prev, oldState, newState, reveal),
      },
      props: {
        decorations: (state) => key.getState(state)?.set,
        // Pasted where its definition isn't, a reference would link nowhere.
        transformCopied: (slice, view) =>
          inlineReferences(slice, view.state.doc),
        handleKeyDown(view, event) {
          if (isImeKeyEvent(view, event)) return false;
          if (event.key === "Enter") {
            enterInLink(view);
            return false;
          }
          const dir = PLAIN_ARROWS[event.key];
          if (
            !dir ||
            event.shiftKey ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
          )
            return false;
          const to = arrowPastLinkEdge(view.state, dir);
          if (to === null) return false;
          event.preventDefault();
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, to),
            ),
          );
          return true;
        },
      },
    });
  });
}
