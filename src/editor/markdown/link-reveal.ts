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
import {
  COMPOSE_RELOCATE_DELAY_MS,
  cursorTouches,
  isImeKeyEvent,
  liveCaretPos,
} from "../marks/enclosure";
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
 * A link shows its Markdown while the caret is on it, as Typora does, and
 * that Markdown is the text to edit: `[text](url)`, `[text](url "title")`,
 * `[text][ref]`, `<https://...>` and a bare URL alike. Bold, code and the
 * other enclosures only show their delimiters (marks/enclosure.ts), as
 * their content is text already; a link's URL is no text in the document,
 * so the link itself turns into its source.
 *
 * While the caret is elsewhere a link is what it always was - text with a
 * link mark - so nothing else in the editor (find, revisions, colour
 * swatches, a screen reader, exports) has a second kind of link to know.
 * When the caret comes onto one (inside it, or right at either end), the
 * linked text is swapped for a link_source node holding the link's
 * Markdown (link-source.ts: as the file has it), with the caret on the
 * same character. When the caret leaves, the node is swapped back: for the
 * link it was, untouched, or for what its text now reads as - a link, or
 * plain text once it no longer is one.
 *
 * The swaps are real edits, made in appendTransaction, so they go into the
 * history with the edit or caret move that caused them, and an undo or
 * redo puts the document back as it was. None is made while there is
 * something to redo: as an edit to the history, the swap would drop it,
 * so after an undo the links stay as they are until the next edit (or the
 * redo). Nor while a mouse button is down
 * (a drag that starts on a link selects its text, and the text must not
 * change under it), nor during an IME composition (any edit then ends it):
 * those settle once the button is up or the composition is over. And a
 * link is shown only while the editor has the focus, so a document opened
 * with its caret on one opens as written, and the find bar or the chat
 * reads it as a link.
 *
 * A save writes a link_source as the link it stands for (toMarkdown
 * below), so the file and the tab's clean state never see a link that is
 * only being looked at; one whose text was edited is written as typed.
 */

/** The linked text, as it was before it was shown as source, as long as
 *  the source still reads as it did. */
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
    /** The source as shown, and the linked text it was shown for (as
     *  JSON) and that text read as text. */
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

/** The link_source nodes' positions, carried through `tr`: those mapped,
 *  and any its steps wrote (an undo, a paste). */
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
 * The edit that puts `state`'s links right for its selection, or null when
 * they are: every link_source the selection has left collapsed (one
 * emptied too, and all of them once the focus is elsewhere in the
 * window), and - with a caret and none being shown, unless `reveal` is
 * false - the link the caret is on shown as its source, the caret on the
 * same character.
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
  // At either end of the link, outside its source: typing there adds to
  // the text around it, as it did beside the link.
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

/** What each editor's link_source nodes turn back into (for
 *  revealedLinkHref). */
const collapsers = new WeakMap<EditorView, (node: ProseNode) => Fragment>();

/** The URL of the link shown as source at `target`, if it is on one -
 *  Ctrl/Cmd+click opens it as it does a link (link-click-plugin.ts). */
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
      // A bare URL is saved as `<...>` (markdown-output.ts), but shown as
      // the file has it.
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
 * A transaction that moves the selection to the caret where the browser
 * has it, when that is on a link the editor's selection isn't: the
 * selectionchange that tells the editor can still be on its way after a
 * click or in a quick run of arrow presses (see stateWithLiveSelection,
 * marks/enclosure.ts), and a Backspace beside the link took the caret's
 * old place. Anywhere else the editor's selection stands - a widget sets
 * one of its own (a fold's summary, a preview), and the browser's caret
 * there can read as another position.
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
 * Where Left or Right takes a caret at an edge of a link's source: one
 * character on, past the edge. Just outside the source and just inside it
 * are one place on the screen, and the browser's own step from one could
 * stop at the other - WebKit's did, after the source was drawn - so a
 * press seemed to do nothing. Null where the browser's step is fine.
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
    // Before the source or at its start: past its first character; at
    // its end, past the character after it.
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
    // link: drawing now would put the caret back where the editor last had
    // it, and arrow presses since were lost. The editor's own read of it
    // settles the links.
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
      // A link just typed or pasted, the caret at its end, shows as the
      // link it now is; the caret moving onto it shows its source.
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
        // Focus moved to another part of the window (the find bar, the
        // chat) leaves the links as links; back, the caret's shows again.
        // Another window taking the focus leaves the editor's in place.
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
        // A key acts on the links as they are for the caret: right after a
        // click, a focus or a composition, or in a quick run of arrow
        // presses, they can still be waiting (see liveSelection).
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
        // Enter at either end of a link's source breaks the line beside
        // the link; inside, the source is split as the text it is.
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
