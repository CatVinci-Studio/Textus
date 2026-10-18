import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { showDocImage } from "../images/image-plugin";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  applyReveal,
  buildReveal,
  caretToSourceOnClick,
  type RevealState,
  type Touches,
} from "../reveal-state";
import { renderWhitelistedHtml } from "./raw-html-sanitize";
import { sanitizeStyle } from "./html-policy";

const rawHtmlPreviewKey = new PluginKey<RawHtmlPreviewState>(
  "raw-html-preview",
);

// Markdown parses inline HTML as SEPARATE nodes: "foo <b>bar</b>" is
// [text, html("<b>"), text("bar"), html("</b>")] - the pair never arrives
// as one fragment. GitHub still renders it as bold "bar" on one line, so
// this plugin pairs matching open/close tags within a textblock and styles
// the text between them via an inline decoration (the tags themselves hide
// while the cursor is away). Only inline FORMATTING tags participate -
// each maps to the class that mimics it.
const PAIR_TAG_CLASSES: Record<string, string> = {
  b: "rhtml-b",
  strong: "rhtml-b",
  i: "rhtml-i",
  em: "rhtml-i",
  u: "rhtml-u",
  ins: "rhtml-u",
  s: "rhtml-s",
  del: "rhtml-s",
  strike: "rhtml-s",
  sub: "rhtml-sub",
  sup: "rhtml-sup",
  mark: "rhtml-mark",
  kbd: "rhtml-kbd",
  code: "rhtml-code",
  small: "rhtml-small",
  a: "rhtml-a",
  span: "",
};

// Void elements can't open a pair - "<img ...>" is complete in itself and
// goes down the fragment-widget path instead.
const VOID_TAGS = new Set(["br", "img", "hr"]);

const OPEN_TAG_RE = /^<([a-zA-Z][a-zA-Z0-9]*)(\s[^<>]*)?>$/;
const CLOSE_TAG_RE = /^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>$/;

interface HtmlChild {
  from: number;
  to: number;
  text: string;
}

function inSummary(event: Event): boolean {
  return (
    event.target instanceof Element && event.target.closest("summary") !== null
  );
}

// ProseMirror leaves a summary's clicks to the browser, which toggles it,
// instead of placing the caret there (which would reveal the source).
function widgetSpec(key: string) {
  return { side: -1, key, stopEvent: inSummary };
}

function fragmentWidget(
  rendered: { html: string; inline: boolean },
  docPath: () => string | null,
) {
  return (view: EditorView, getPos: () => number | undefined) => {
    // Inline fragments (a lone <img>, <kbd>x</kbd>, <br>) stay in the
    // line they were written in; only block-level content (alignment
    // wrappers, headings) becomes its own block - matching GitHub.
    const el = document.createElement(rendered.inline ? "span" : "div");
    el.className = rendered.inline
      ? "raw-html-rendered raw-html-rendered-inline"
      : "raw-html-rendered";
    el.innerHTML = rendered.html;
    // An <img src="pic.png"> means the file beside the document, as in
    // Typora - left as is, the webview looked for it in the app itself.
    // An inline SVG's picture is a data URL already.
    el.querySelectorAll<HTMLImageElement>("img:not(.html-svg)").forEach((img) =>
      showDocImage(img, img.getAttribute("src") ?? "", docPath()),
    );
    caretToSourceOnClick(el, view, getPos, inSummary);
    return el;
  };
}

const COMMENT_RE = /^(\s*<!--\s*)([\s\S]*?)(\s*-->\s*)$/;

/** Where an HTML node that is one whole comment keeps its text, as offsets
 *  into it: the body without the markers and the blank lines around it.
 *  Null for anything else. */
export function commentParts(
  text: string,
): { bodyFrom: number; bodyTo: number } | null {
  const match = COMMENT_RE.exec(text);
  // "<!-- a --> <b>x</b> <!-- b -->" isn't one comment: its middle has a
  // closing marker of its own.
  if (!match || match[2].includes("-->")) return null;
  const bodyFrom = match[1].length;
  return { bodyFrom, bodyTo: bodyFrom + match[2].length };
}

/** The href of a paired <a ...> open tag, scheme-validated by the same
 *  sanitizer whitelist - shown as a hover title on the styled range. */
function pairedLinkTitle(openTag: string): string | undefined {
  const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(openTag);
  const value = href?.[2] ?? href?.[3];
  return value || undefined;
}

/** A paired open tag's `style`, cut down to what the policy allows
 *  (html-policy.ts): `<span style="color: red">` colours the text between. */
function pairedStyle(openTag: string): string | null {
  const style = /\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(openTag);
  const value = style?.[2] ?? style?.[3];
  return value ? sanitizeStyle(value) : null;
}

const SVG_OPEN_RE = /^<svg[\s>]/i;
const SVG_CLOSE_RE = /^<\/svg\s*>$/i;
const selfClosed = (tag: string) => /\/>$/.test(tag);

/**
 * An SVG written inside a line of text: markdown splits it into one HTML
 * node per tag ("<svg ...>", "<circle/>", "</svg>"), with any text between
 * as text nodes. Each run from an <svg> to its </svg> is one picture; the
 * HTML nodes a run spans are left out of `rest`.
 */
function inlineSvgRuns(
  block: ProseNode,
  blockPos: number,
  htmls: HtmlChild[],
): { runs: HtmlChild[]; rest: HtmlChild[] } {
  const runs: HtmlChild[] = [];
  const rest: HtmlChild[] = [];
  for (let i = 0; i < htmls.length; i++) {
    const first = htmls[i].text.trim();
    let end = -1;
    if (
      SVG_OPEN_RE.test(first) &&
      !selfClosed(first) &&
      !/<\/svg\s*>$/i.test(first)
    ) {
      let depth = 0;
      for (let j = i; j < htmls.length; j++) {
        const tag = htmls[j].text.trim();
        if (SVG_OPEN_RE.test(tag) && !selfClosed(tag)) depth++;
        else if (SVG_CLOSE_RE.test(tag) && --depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) {
      rest.push(htmls[i]);
      continue;
    }
    const from = htmls[i].from;
    const to = htmls[end].to;
    const start = blockPos + 1;
    runs.push({ from, to, text: block.textBetween(from - start, to - start) });
    i = end;
  }
  return { runs, rest };
}

function decorateTextblock(
  block: ProseNode,
  blockPos: number,
  touches: Touches,
  decorations: Decoration[],
  docPath: () => string | null,
  handled: Set<number>,
) {
  const all: HtmlChild[] = [];
  block.forEach((child, offset) => {
    const from = blockPos + 1 + offset;
    // A <details> split around markdown is decorateDetails' to draw.
    if (child.type.name === "html" && !handled.has(from))
      all.push({ from, to: from + child.nodeSize, text: child.textContent });
  });
  if (all.length === 0) return;
  const { runs, rest: htmls } = inlineSvgRuns(block, blockPos, all);

  for (const run of runs) {
    if (touches(run.from, run.to)) continue;
    const rendered = renderWhitelistedHtml(run.text);
    if (rendered === null) continue;
    decorations.push(
      Decoration.inline(run.from, run.to, { class: "raw-html-source-hidden" }),
      Decoration.widget(
        run.to,
        fragmentWidget(rendered, docPath),
        widgetSpec(`svg\n${run.text}`),
      ),
    );
  }

  const stack: { tag: string; item: HtmlChild }[] = [];
  const pairs: { tag: string; open: HtmlChild; close: HtmlChild }[] = [];
  const fragments: HtmlChild[] = [];

  for (const item of htmls) {
    const open = OPEN_TAG_RE.exec(item.text);
    if (
      open &&
      open[1].toLowerCase() in PAIR_TAG_CLASSES &&
      !VOID_TAGS.has(open[1].toLowerCase())
    ) {
      stack.push({ tag: open[1].toLowerCase(), item });
      continue;
    }
    const close = CLOSE_TAG_RE.exec(item.text);
    if (close && close[1].toLowerCase() in PAIR_TAG_CLASSES) {
      const tag = close[1].toLowerCase();
      let openIdx = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          openIdx = i;
          break;
        }
      }
      // No matching open: leave the stray close tag as visible raw text.
      // Mis-nested opens skipped over by this match stay unstyled too.
      if (openIdx >= 0) {
        pairs.push({ tag, open: stack[openIdx].item, close: item });
        stack.length = openIdx;
      }
      continue;
    }
    // Unmatched lone open/close tags of pairable elements never reach
    // here - anything else (a void tag, a self-contained fragment like
    // "<b>x</b>", a full block of HTML) renders as a widget below.
    fragments.push(item);
  }

  for (const { tag, open, close } of pairs) {
    // Cursor on either tag reveals BOTH raw (the pair is one edit unit).
    // Both asked unconditionally: each is a range a caret move can flip.
    const touchesOpen = touches(open.from, open.to);
    const touchesClose = touches(close.from, close.to);
    if (touchesOpen || touchesClose) continue;
    decorations.push(
      Decoration.inline(open.from, open.to, {
        class: "raw-html-source-hidden",
      }),
    );
    decorations.push(
      Decoration.inline(close.from, close.to, {
        class: "raw-html-source-hidden",
      }),
    );
    if (close.from <= open.to) continue; // nothing between the tags
    const cls = PAIR_TAG_CLASSES[tag];
    const attrs: Record<string, string> = {};
    if (cls) attrs.class = cls;
    if (tag === "a") {
      const title = pairedLinkTitle(open.text);
      if (title) attrs.title = title;
    }
    const style = pairedStyle(open.text);
    if (style) attrs.style = style;
    if (Object.keys(attrs).length > 0)
      decorations.push(Decoration.inline(open.to, close.from, attrs));
  }

  for (const item of fragments) {
    if (touches(item.from, item.to)) continue;
    const comment = commentParts(item.text);
    if (comment) {
      // A note to the reader of the source - the project templates
      // (.textus/style.md, library entries, agent.md) explain themselves
      // in one, and the AI never sees it. The sanitizer drops comments,
      // so it used to stay as raw "<!-- … -->"; it reads as a quiet note
      // instead, its markers back under the caret.
      const start = item.from + 1;
      decorations.push(
        Decoration.inline(start, start + comment.bodyFrom, {
          class: "raw-html-source-hidden",
        }),
        Decoration.inline(start + comment.bodyTo, item.to - 1, {
          class: "raw-html-source-hidden",
        }),
      );
      if (comment.bodyTo > comment.bodyFrom)
        decorations.push(
          Decoration.inline(start + comment.bodyFrom, start + comment.bodyTo, {
            class: "raw-html-comment",
          }),
        );
      continue;
    }
    const rendered = renderWhitelistedHtml(item.text);
    // Not whitelisted (or unparsable): raw text stays visible, the
    // existing fallback for anything outside the whitelist.
    if (rendered === null) continue;
    decorations.push(
      Decoration.inline(item.from + 1, item.to - 1, {
        class: "raw-html-source-hidden",
      }),
    );
    decorations.push(
      Decoration.widget(
        item.to,
        fragmentWidget(rendered, docPath),
        // Kept across rebuilds while the text is the same: a <details>
        // the reader opened stays open while they type elsewhere.
        widgetSpec(`${docPath() ?? ""}\n${item.text}`),
      ),
    );
  }
}

// --- <details> around markdown ------------------------------------------

const DETAILS_OPEN_RE = /^<details[\s>]/i;
const DETAILS_CLOSE_RE = /^<\/details\s*>$/i;

/** A top-level paragraph that is one HTML node, and that node. */
function loneHtml(node: ProseNode, pos: number): HtmlChild | null {
  if (node.type.name !== "paragraph" || node.childCount !== 1) return null;
  const child = node.firstChild!;
  if (child.type.name !== "html") return null;
  return {
    from: pos + 1,
    to: pos + 1 + child.nodeSize,
    text: child.textContent,
  };
}

interface DetailsSpan {
  /** The paragraph holding "<details><summary>…</summary>". */
  headPos: number;
  head: HtmlChild;
  /** Where the blocks between start, and where "</details>"'s paragraph is. */
  bodyFrom: number;
  endPos: number;
  end: HtmlChild;
  endSize: number;
}

/**
 * GitHub's usual way to fold markdown: "<details>" and "<summary>" in one
 * HTML block, the markdown after a blank line, and "</details>" in a block
 * of its own. Markdown makes those separate paragraphs, so the pair is
 * found at the top level of the document (nested pairs included).
 */
function findDetailsSpans(doc: ProseNode): DetailsSpan[] {
  const spans: DetailsSpan[] = [];
  const stack: { pos: number; size: number; head: HtmlChild }[] = [];
  doc.forEach((node, pos) => {
    const html = loneHtml(node, pos);
    if (!html) return;
    const text = html.text.trim();
    if (DETAILS_OPEN_RE.test(text) && !/<\/details\s*>/i.test(text)) {
      stack.push({ pos, size: node.nodeSize, head: html });
    } else if (DETAILS_CLOSE_RE.test(text)) {
      const open = stack.pop();
      if (open)
        spans.push({
          headPos: open.pos,
          head: open.head,
          bodyFrom: open.pos + open.size,
          endPos: pos,
          end: html,
          endSize: node.nodeSize,
        });
    }
  });
  return spans;
}

/** Folded state per <details>, by its head paragraph's position. */
type OpenStates = Map<number, boolean>;

/** Open as the reader left it, or else as written (`<details open>`). */
function isFoldOpen(span: DetailsSpan, open: OpenStates): boolean {
  return (
    open.get(span.headPos) ??
    /^<details\b[^>]*\sopen\b/i.test(span.head.text.trim())
  );
}

/** What the plugin's state takes to open or fold: [head position, open]. */
type FoldMeta = { set: [number, boolean][] };

/**
 * Something another plugin points the writer at - a proposed edit, a review
 * note - declared on its spec as `foldAttention`. A folded <details> opens
 * when an item with a key it hasn't seen lands in its hidden text; the
 * writer can fold it again afterwards.
 */
export interface FoldAttentionItem {
  key: string;
  from: number;
  to: number;
}
export type FoldAttention = (
  state: EditorState,
) => readonly FoldAttentionItem[];

function attentionItems(state: EditorState): FoldAttentionItem[] {
  const items: FoldAttentionItem[] = [];
  for (const plugin of state.plugins) {
    const read = (plugin.spec as { foldAttention?: FoldAttention })
      .foldAttention;
    if (read) items.push(...read(state));
  }
  return items;
}

// A transaction meta: open whatever folds hide [from, to] (revealRange).
const REVEAL_META = "details-reveal";

/** The folded <details> whose hidden text holds part of [from, to]. */
function foldsHiding(
  spans: DetailsSpan[],
  open: OpenStates,
  from: number,
  to: number,
): number[] {
  return spans
    .filter(
      (s) =>
        s.endPos > s.bodyFrom &&
        from < s.endPos &&
        to > s.bodyFrom &&
        !isFoldOpen(s, open),
    )
    .map((s) => s.headPos);
}

/**
 * Opens every folded <details> hiding [from, to], so whatever points there -
 * a find match, an outline jump - lands on text the reader can see.
 * Dispatches only when something was folded; true if it did.
 */
export function revealRange(
  view: EditorView,
  from: number,
  to: number = from,
): boolean {
  const open = rawHtmlPreviewKey.getState(view.state)?.open;
  if (!open) return false;
  const heads = foldsHiding(findDetailsSpans(view.state.doc), open, from, to);
  if (heads.length === 0) return false;
  view.dispatch(view.state.tr.setMeta(REVEAL_META, { from, to }));
  return true;
}

// The DOM event revealElement sends, for callers holding only an element.
const REVEAL_EVENT = "textus-reveal";

/** revealRange for an element of the editor's own DOM (the outline holds
 *  its heading's element, not a position). */
export function revealElement(el: Element): void {
  el.dispatchEvent(new CustomEvent(REVEAL_EVENT, { bubbles: true }));
}

/**
 * The folds to open after these transactions: one hiding the selection
 * (the caret moved into folded text, or text was typed there), one an
 * explicit revealRange asked for, one where another plugin's new
 * attention item (foldAttention) landed.
 */
function unfoldFor(
  trs: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
): FoldMeta | null {
  const open = rawHtmlPreviewKey.getState(newState)?.open;
  if (!open) return null;
  const spans = findDetailsSpans(newState.doc);
  if (spans.length === 0) return null;
  const ranges: [number, number][] = [];
  if (trs.some((tr) => tr.selectionSet || tr.docChanged))
    ranges.push([newState.selection.from, newState.selection.to]);
  for (const tr of trs) {
    const reveal = tr.getMeta(REVEAL_META) as
      { from: number; to: number } | undefined;
    if (reveal) ranges.push([reveal.from, reveal.to]);
  }
  const seen = new Set(attentionItems(oldState).map((item) => item.key));
  for (const item of attentionItems(newState))
    if (!seen.has(item.key)) ranges.push([item.from, item.to]);

  const heads = new Set<number>();
  for (const [from, to] of ranges)
    for (const head of foldsHiding(spans, open, from, to)) heads.add(head);
  if (heads.size === 0) return null;
  return { set: [...heads].map((head) => [head, true]) };
}

/** ArrowUp/Down into a paragraph that is all HTML drawn as a block (a
 *  <details> head, a table) or hidden (a "</details>" line): the browser
 *  has no text there to stop on and skipped it, so its source could only
 *  be reached with the mouse. The caret goes into the source instead. */
function arrowIntoHtmlBlock(view: EditorView, event: KeyboardEvent): boolean {
  const dir =
    event.key === "ArrowDown" ? "down" : event.key === "ArrowUp" ? "up" : null;
  if (!dir || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)
    return false;
  const { selection, doc } = view.state;
  // Where the browser's caret is: a key pressed right after a native caret
  // move (End, Home, a click) can arrive before the editor state has read
  // that move, and the state's caret is then a line or more behind.
  let head = selection.head;
  const dom = (view.root as Document).getSelection?.();
  if (dom?.focusNode && view.dom.contains(dom.focusNode)) {
    if (!dom.isCollapsed) return false;
    try {
      head = view.posAtDOM(dom.focusNode, dom.focusOffset);
    } catch {
      // Not a position the editor knows - keep the state's.
    }
  } else if (!selection.empty) return false;
  const $head = doc.resolve(head);
  if ($head.depth !== 1 || !view.endOfTextblock(dir)) return false;
  const index = $head.index(0) + (dir === "down" ? 1 : -1);
  if (index < 0 || index >= doc.childCount) return false;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  const html = loneHtml(doc.child(index), pos);
  if (!html) return false;
  const target = dir === "down" ? html.from + 1 : html.to - 1;
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(doc, target))
      .scrollIntoView(),
  );
  return true;
}

function detailsHeadWidget(html: string, open: boolean, headPos: number) {
  return (view: EditorView, getPos: () => number | undefined) => {
    const el = document.createElement("div");
    caretToSourceOnClick(el, view, getPos, inSummary);
    el.className = "raw-html-rendered raw-html-details-head";
    el.innerHTML = html;
    const details = el.querySelector("details");
    if (details) {
      details.open = open;
      details.dataset.detailsHead = String(headPos);
    }
    // The body is the paragraphs below, not the element's children, so
    // the toggle goes through the editor state instead of the browser.
    el.addEventListener("click", (event) => {
      if (!inSummary(event)) return;
      event.preventDefault();
      view.dispatch(
        view.state.tr
          .setMeta(rawHtmlPreviewKey, { set: [[headPos, !open]] } as FoldMeta)
          .setMeta("addToHistory", false),
      );
    });
    return el;
  };
}

function decorateDetails(
  state: EditorState,
  open: OpenStates,
  touches: Touches,
  decorations: Decoration[],
  handled: Set<number>,
) {
  // A folded outer one hides every block inside, inner heads included.
  for (const span of findDetailsSpans(state.doc)) {
    handled.add(span.head.from);
    handled.add(span.end.from);
    const onHead = touches(span.head.from, span.head.to);
    const onEnd = touches(span.end.from, span.end.to);
    const rendered = renderWhitelistedHtml(span.head.text);
    // The caret in the folded text opens it for good (unfoldFor below).
    const showBody = isFoldOpen(span, open) || onHead || onEnd || !rendered;

    if (rendered && !onHead && !onEnd) {
      decorations.push(
        Decoration.inline(span.head.from + 1, span.head.to - 1, {
          class: "raw-html-source-hidden",
        }),
        Decoration.widget(
          span.head.to,
          detailsHeadWidget(rendered.html, showBody, span.headPos),
          widgetSpec(
            `details\n${span.headPos}\n${showBody}\n${span.head.text}`,
          ),
        ),
        // "</details>" says nothing to the reader; its line goes too.
        Decoration.node(span.endPos, span.endPos + span.endSize, {
          class: "raw-html-details-end",
        }),
      );
    }
    // Every block of the body says whose it is, so an export can put
    // them back inside the <details> (export/exporters.ts).
    state.doc.nodesBetween(span.bodyFrom, span.endPos, (node, pos) => {
      if (pos < span.bodyFrom || pos >= span.endPos) return false;
      const classes = [`raw-html-details-in-${span.headPos}`];
      if (!showBody) classes.push("raw-html-details-folded");
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: classes.join(" "),
        }),
      );
      return false;
    });
  }
}

function buildDecorations(
  state: EditorState,
  docPath: () => string | null,
  open: OpenStates,
): RevealState {
  return buildReveal(state, (touches) => {
    const decorations: Decoration[] = [];
    const handled = new Set<number>();
    decorateDetails(state, open, touches, decorations, handled);
    state.doc.descendants((node, pos) => {
      if (node.isTextblock) {
        decorateTextblock(node, pos, touches, decorations, docPath, handled);
        return false; // textblocks don't nest
      }
      return undefined;
    });
    return decorations;
  });
}

interface RawHtmlPreviewState {
  reveal: RevealState;
  open: OpenStates;
}

function mapOpen(open: OpenStates, tr: Transaction): OpenStates {
  if (!tr.docChanged || open.size === 0) return open;
  const mapped: OpenStates = new Map();
  open.forEach((value, pos) => {
    const result = tr.mapping.mapResult(pos);
    if (!result.deleted) mapped.set(result.pos, value);
  });
  return mapped;
}

/**
 * Raw-HTML counterpart to math-preview-plugin.ts: while the cursor is away,
 * whitelisted HTML renders in place of its source - paired inline tags
 * style the text between them right in the line (GitHub-style), and
 * self-contained fragments show as sanitized inline or block widgets.
 * Cursor on any of it reveals the raw markup for direct editing.
 */
export function createRawHtmlPreviewPlugin(
  options: {
    /** The open document's path, for an <img> with a relative src. */
    docPath?: () => string | null;
  } = {},
) {
  const docPath = options.docPath ?? (() => null);
  return $prose(
    () =>
      new Plugin<RawHtmlPreviewState>({
        key: rawHtmlPreviewKey,
        state: {
          init: (_config, state) => {
            const open: OpenStates = new Map();
            return { reveal: buildDecorations(state, docPath, open), open };
          },
          apply: (tr, prev, oldState, newState) => {
            let open = mapOpen(prev.open, tr);
            const toggle = tr.getMeta(rawHtmlPreviewKey) as
              FoldMeta | undefined;
            if (toggle) {
              open = new Map(open);
              for (const [pos, value] of toggle.set) open.set(pos, value);
            }
            const build = (s: EditorState) =>
              buildDecorations(s, docPath, open);
            const reveal = toggle
              ? build(newState)
              : applyReveal(tr, prev.reveal, oldState, newState, build);
            return { reveal, open };
          },
        },
        appendTransaction: (trs, oldState, newState) => {
          const meta = unfoldFor(trs, oldState, newState);
          return meta
            ? newState.tr
                .setMeta(rawHtmlPreviewKey, meta)
                .setMeta("addToHistory", false)
            : null;
        },
        props: {
          decorations(state) {
            return rawHtmlPreviewKey.getState(state)?.reveal.set;
          },
          handleKeyDown: arrowIntoHtmlBlock,
          handleDOMEvents: {
            [REVEAL_EVENT]: (view, event) => {
              if (!(event.target instanceof Node)) return false;
              const pos = view.posAtDOM(event.target, 0);
              revealRange(view, pos);
              return true;
            },
          },
        },
      }),
  );
}
