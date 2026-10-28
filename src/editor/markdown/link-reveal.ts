import { parserCtx, schemaCtx, serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { Fragment } from "@milkdown/kit/prose/model";
import type { Node as ProseNode, Schema } from "@milkdown/kit/prose/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import { redoDepth } from "@milkdown/kit/prose/history";
import { $nodeSchema, $prose } from "@milkdown/kit/utils";
import { changedRanges } from "../changed-ranges";
import { COMPOSE_RELOCATE_DELAY_MS, cursorTouches } from "../marks/enclosure";
import { liveCaretPos } from "../live-selection";
import { isImeKeyEvent } from "../keys/ime";
import { readLinkSource } from "./link-source";
import { linksOnSpansIn } from "./markdown-output";
import {
  type LinkRun,
  LINK_SOURCE,
  caretInSource,
  definitionsIn,
  linkRunAt,
  linkSyntaxRanges,
  parseLinkSource,
} from "./link-runs";
export {
  type LinkRun,
  LINK_SOURCE,
  linkRunAt,
  caretInSource,
  parseLinkSource,
  linkSyntaxRanges,
  visibleTextBetween,
} from "./link-runs";
/**
 * A link shows its Markdown while the caret is on it, as in Typora, and that
 * Markdown is the text to edit: the linked text is swapped for a link_source
 * node, and back once the caret leaves. Elsewhere a link stays an ordinary
 * link mark, so nothing else has a second kind of link to know.
 *
 * The swaps are real edits in appendTransaction, so undo and redo restore
 * the document. None is made while there is something to redo (it would
 * drop it), while a mouse button is down, during a composition, or without
 * the focus. A save writes a link_source as the link it stands for.
 */

/** The linked text as it was before it was shown as source, while the
 *  source still reads as it did. */
const keptCache = new Map<string, Fragment>();

function keptContent(schema: Schema, node: ProseNode): Fragment | null {
  const { restore, source } = node.attrs as { restore: string; source: string };
  if (!restore || node.textContent !== source) return null;
  let kept = keptCache.get(restore);
  if (!kept) {
    try {
      kept = Fragment.fromJSON(schema, JSON.parse(restore));
    } catch {
      return null;
    }
    if (keptCache.size > 32) keptCache.clear();
    keptCache.set(restore, kept);
  }
  return kept;
}

export const linkSourceSchema = $nodeSchema(LINK_SOURCE, (ctx) => ({
  content: "text*",
  group: "inline",
  inline: true,
  marks: "",
  // Source, like raw HTML: "*" typed in a URL is not bold.
  code: true,
  attrs: {
    /** The source as shown, the linked text it was shown for (as JSON), and
     *  that text read as text. */
    source: { default: "", validate: "string" },
    restore: { default: "", validate: "string" },
    text: { default: "", validate: "string" },
  },
  parseDOM: [
    { tag: `span[data-type="${LINK_SOURCE}"]`, preserveWhitespace: "full" },
  ],
  toDOM: () => [
    "span",
    { "data-type": LINK_SOURCE, class: "link-source", spellcheck: "false" },
    0,
  ],
  parseMarkdown: { match: () => false, runner: () => {} },
  toMarkdown: {
    match: (node) => node.type.name === LINK_SOURCE,
    runner: (state, node) => {
      const kept = keptContent(ctx.get(schemaCtx), node);
      if (kept) state.next(linksOnSpansIn(kept) ?? kept);
      // As typed, like raw HTML: the user's own Markdown.
      else if (node.textContent)
        state.addNode("html", undefined, node.textContent);
    },
  },
}));

/** What revealing and collapsing need from the editor. */
export interface LinkRevealDeps {
  /** Whether a link may be shown: the editor has the focus. */
  focused: boolean;
  /** A run's Markdown. */
  source: (doc: ProseNode, run: LinkRun) => string;
  /** What a link_source turns back into. */
  collapse: (node: ProseNode, doc: ProseNode) => Fragment;
}

export const linkRevealKey = new PluginKey<number[]>("link-reveal");

/** The link_source nodes' positions, carried through `tr`, plus any its
 *  steps wrote (an undo, a paste). */
function trackSources(tr: Transaction, prev: number[]): number[] {
  if (!tr.docChanged) return prev;
  const found = new Set<number>();
  const isSource = (pos: number) =>
    tr.doc.nodeAt(pos)?.type.name === LINK_SOURCE;
  for (const pos of prev) {
    const mapped = tr.mapping.map(pos, 1);
    if (isSource(mapped)) found.add(mapped);
  }
  for (const [from, to] of changedRanges(tr))
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === LINK_SOURCE) found.add(pos);
      return node.type.name !== LINK_SOURCE;
    });
  return [...found].sort((a, b) => a - b);
}

/**
 * The edit that puts `state`'s links right for its selection, or null:
 * every link_source the selection left collapsed, and the link the caret is
 * on shown as its source (unless `reveal` is false).
 */
export function linkRevealTransaction(
  state: EditorState,
  deps: LinkRevealDeps,
  reveal = true,
): Transaction | null {
  const positions = linkRevealKey.getState(state) ?? [];
  const { selection, doc } = state;
  const tr = state.tr;
  let shown = false;
  for (let i = positions.length - 1; i >= 0; i--) {
    const pos = positions[i];
    const node = doc.nodeAt(pos);
    if (node?.type.name !== LINK_SOURCE) continue;
    const end = pos + node.nodeSize;
    if (
      deps.focused &&
      node.content.size > 0 &&
      cursorTouches(selection, pos, end)
    ) {
      shown = true;
      continue;
    }
    tr.replaceWith(pos, end, deps.collapse(node, doc));
  }
  if (reveal && !shown && selection.empty && deps.focused) {
    const caret = tr.mapping.map(selection.from);
    const run = linkRunAt(tr.doc, caret);
    if (run) revealRun(tr, run, caret, deps.source(tr.doc, run));
  }
  return tr.docChanged ? tr.setMeta(linkRevealKey, "reveal") : null;
}

function revealRun(
  tr: Transaction,
  run: LinkRun,
  caret: number,
  source: string,
): void {
  const { doc } = tr;
  const { schema } = doc.type;
  const content = doc.slice(run.from, run.to).content;
  const visible = doc.textBetween(run.from, run.to);
  const node = schema.nodes[LINK_SOURCE].create(
    { source, restore: JSON.stringify(content.toJSON()), text: visible },
    source ? schema.text(source) : null,
  );
  tr.replaceWith(run.from, run.to, node);
  // At either end of the link, outside its source: typing there adds to the
  // text around it.
  const at =
    caret <= run.from
      ? run.from
      : caret >= run.to
        ? run.from + node.nodeSize
        : run.from +
          1 +
          caretInSource(
            visible,
            source,
            doc.textBetween(run.from, caret).length,
          );
  tr.setSelection(TextSelection.create(tr.doc, at));
}

function syntaxDecorations(state: EditorState): DecorationSet | null {
  const positions = linkRevealKey.getState(state);
  if (!positions?.length) return null;
  const decorations: Decoration[] = [];
  for (const pos of positions) {
    const node = state.doc.nodeAt(pos);
    if (node?.type.name !== LINK_SOURCE) continue;
    for (const [from, to] of linkSyntaxRanges(node.textContent))
      decorations.push(
        Decoration.inline(pos + 1 + from, pos + 1 + to, {
          class: "link-source-syntax",
        }),
      );
  }
  return DecorationSet.create(state.doc, decorations);
}

/** What each editor's link_source nodes turn back into. */
const collapsers = new WeakMap<EditorView, (node: ProseNode) => Fragment>();

/** The URL of the link shown as source at `target`, for Ctrl/Cmd+click. */
export function revealedLinkHref(
  view: EditorView,
  target: EventTarget | null,
): string | null {
  const el = (target as Element | null)?.closest?.(
    `[data-type="${LINK_SOURCE}"]`,
  );
  const collapse = collapsers.get(view);
  if (!el || !collapse || !view.dom.contains(el)) return null;
  let node: ProseNode;
  try {
    node = view.state.doc.resolve(view.posAtDOM(el, 0)).parent;
  } catch {
    return null;
  }
  if (node.type.name !== LINK_SOURCE) return null;
  let href: string | null = null;
  collapse(node).descendants((child) => {
    href ??=
      (child.marks.find((mark) => mark.type.name === "link")?.attrs.href as
        string | undefined) ?? null;
    return href === null;
  });
  return href;
}

/** The deps the editor's own plugin works with. */
function editorDeps(ctx: Ctx, focused: boolean): LinkRevealDeps {
  const schema = ctx.get(schemaCtx);
  return {
    focused,
    source: (doc, run) => {
      const written = ctx
        .get(serializerCtx)(
          schema.topNodeType.create(
            null,
            schema.nodes.paragraph.create(
              null,
              doc.slice(run.from, run.to).content,
            ),
          ),
        )
        .replace(/\n+$/, "");
      // A bare URL is saved as `<...>`, but shown as the file has it.
      const typed = readLinkSource(run.link.attrs.source)?.source;
      return typed && written === `<${typed}>` ? typed : written;
    },
    collapse: (node, doc) =>
      keptContent(schema, node) ??
      parseLinkSource(ctx.get(parserCtx), schema, node.textContent, () =>
        definitionsIn(doc),
      ),
  };
}

/**
 * Moves the selection to the browser's caret when that is on a link the
 * editor's selection isn't: the selectionchange can still be on its way.
 * Elsewhere the editor's selection stands, since widgets set their own.
 */
function liveSelection(view: EditorView): Transaction {
  const { state } = view;
  const tr = state.tr;
  const live = state.selection.empty ? liveCaretPos(view) : null;
  if (live === null || live === state.selection.from) return tr;
  const onLink = (pos: number) =>
    linkRunAt(state.doc, pos) !== null ||
    state.doc.resolve(pos).parent.type.name === LINK_SOURCE ||
    (linkRevealKey.getState(state) ?? []).some((at) => {
      const node = state.doc.nodeAt(at);
      return node !== null && at <= pos && pos <= at + node.nodeSize;
    });
  if (onLink(live) || onLink(state.selection.from))
    tr.setSelection(TextSelection.create(tr.doc, live));
  return tr;
}

/**
 * Where Left or Right takes a caret at an edge of a link's source: past the
 * edge. Just outside and just inside are one place on screen, and WebKit's
 * own step stopped at the other. Null where the browser's step is fine.
 */
export function arrowPastSourceEdge(
  state: EditorState,
  dir: 1 | -1,
): number | null {
  const { selection, doc } = state;
  if (!selection.empty) return null;
  const { $from, from } = selection;
  let start: number;
  if ($from.parent.type.name === LINK_SOURCE) start = $from.before();
  else if ($from.nodeAfter?.type.name === LINK_SOURCE) start = from;
  else if ($from.nodeBefore?.type.name === LINK_SOURCE)
    start = from - $from.nodeBefore.nodeSize;
  else return null;
  const node = doc.nodeAt(start)!;
  const end = start + node.nodeSize;
  if (node.content.size === 0) return null;
  const atStart = from === start || from === start + 1;
  const atEnd = from === end || from === end - 1;
  if (dir === 1) {
    // Before the source or at its start: past its first character; at its end,
    // past the character after it.
    if (atStart) return start + 2;
    if (atEnd && doc.resolve(end).nodeAfter?.isText) return end + 1;
    return null;
  }
  if (atEnd) return end - 2;
  if (atStart && doc.resolve(start).nodeBefore?.isText) return start - 1;
  return null;
}

/** After the mouse button is up or a composition is over: settle. */
const SETTLE_AFTER_COMPOSITION_MS = COMPOSE_RELOCATE_DELAY_MS + 20;

export const linkRevealPlugin = $prose((ctx) => {
  let view: EditorView | null = null;
  let mouseDown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  /** Puts the links right for the caret. */
  const settleNow = () => {
    clearTimeout(timer);
    pending = false;
    if (!view || view.isDestroyed || view.composing) return;
    const tr = liveSelection(view);
    // The browser's caret is somewhere the editor hasn't read yet, off any
    // link: drawing now would lose arrow presses. The editor's own read settles.
    const live = view.state.selection.empty ? liveCaretPos(view) : null;
    if (!tr.selectionSet && live !== null && live !== view.state.selection.from)
      return;
    view.dispatch(tr.setMeta(linkRevealKey, "settle"));
  };
  const settle = (delay: number) => {
    clearTimeout(timer);
    pending = true;
    timer = setTimeout(settleNow, delay);
  };
  const onMouseUp = () => {
    mouseDown = false;
    settleNow();
  };
  return new Plugin<number[]>({
    key: linkRevealKey,
    state: {
      init: () => [],
      apply: (tr, prev) => trackSources(tr, prev),
    },
    appendTransaction(trs, _oldState, state) {
      if (!view || view.composing || mouseDown || redoDepth(state) > 0)
        return null;
      // A link just typed or pasted shows as the link it now is; the caret
      // moving onto it shows its source.
      const edited = trs.some(
        (tr) => tr.docChanged && tr.getMeta(linkRevealKey) === undefined,
      );
      return linkRevealTransaction(
        state,
        editorDeps(ctx, view.hasFocus()),
        !edited,
      );
    },
    view(editorView) {
      view = editorView;
      collapsers.set(editorView, (node) =>
        editorDeps(ctx, false).collapse(node, editorView.state.doc),
      );
      return {
        destroy() {
          clearTimeout(timer);
          window.removeEventListener("mouseup", onMouseUp);
          view = null;
        },
      };
    },
    props: {
      decorations: syntaxDecorations,
      handleDOMEvents: {
        mousedown() {
          mouseDown = true;
          window.addEventListener("mouseup", onMouseUp, { once: true });
          return false;
        },
        // Focus moving within the window leaves the links as links; back, the
        // caret's shows again.
        focus() {
          settle(0);
          return false;
        },
        blur() {
          settle(0);
          return false;
        },
        compositionend() {
          settle(SETTLE_AFTER_COMPOSITION_MS);
          return false;
        },
      },
      handleKeyDown(editorView, event) {
        // A mouseup outside the window can go unseen.
        mouseDown = false;
        if (isImeKeyEvent(editorView, event)) return false;
        // A key acts on the links as they are for the caret, which may still be
        // waiting to settle.
        if (pending || liveSelection(editorView).selectionSet) settleNow();
        if (
          (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
          !event.shiftKey &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          const to = arrowPastSourceEdge(
            editorView.state,
            event.key === "ArrowRight" ? 1 : -1,
          );
          if (to === null) return false;
          event.preventDefault();
          editorView.dispatch(
            editorView.state.tr.setSelection(
              TextSelection.create(editorView.state.doc, to),
            ),
          );
          return true;
        }
        if (event.key !== "Enter") return false;
        const { selection } = editorView.state;
        const { $from } = selection;
        if (!selection.empty || $from.parent.type.name !== LINK_SOURCE)
          return false;
        // Enter at either end of a link's source breaks the line beside the link;
        // inside, the source is split as the text it is.
        const node = $from.parent;
        const start = $from.before();
        const tr = editorView.state.tr;
        if ($from.parentOffset === 0)
          tr.setSelection(TextSelection.create(tr.doc, start));
        else if ($from.parentOffset === node.content.size)
          tr.setSelection(TextSelection.create(tr.doc, start + node.nodeSize));
        else {
          tr.replaceWith(
            start,
            start + node.nodeSize,
            editorView.state.schema.text(node.textContent),
          );
          tr.setSelection(
            TextSelection.create(tr.doc, start + $from.parentOffset),
          );
        }
        editorView.dispatch(tr);
        return false;
      },
    },
  });
});
