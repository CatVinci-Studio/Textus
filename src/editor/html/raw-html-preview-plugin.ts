import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { showDocImage } from "../images/image-plugin";
import { stateWithLiveSelection } from "../marks/enclosure";
import type { Node as ProseNode, ResolvedPos } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  caretToSourceOnClick,
  redrawReveal,
  revealAll,
  revealChanges,
  type Reveal,
  type Touches,
} from "../reveal-state";
import { renderWhitelistedHtml } from "./raw-html-sanitize";
import { sanitizeStyle } from "./html-policy";
import {
  arrowIntoHtmlBlock,
  decorateDetails,
  detailsTouched,
  findDetailsSpans,
  mapSpans,
  inSummary,
  mapOpen,
  rawHtmlPreviewKey,
  unfoldEventHandlers,
  unfoldFor,
  widgetSpec,
  type FoldMeta,
  type HtmlChild,
  type OpenStates,
  type RawHtmlPreviewState,
} from "./details-fold";

// Markdown parses "foo <b>bar</b>" as separate html and text nodes, so
// matching inline formatting tags are paired within a textblock and the
// text between is styled, the tags hidden while the caret is away.
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

// Void elements can't open a pair; they render as fragments.
const VOID_TAGS = new Set(["br", "img", "hr"]);

const OPEN_TAG_RE = /^<([a-zA-Z][a-zA-Z0-9]*)(\s[^<>]*)?>$/;
const CLOSE_TAG_RE = /^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>$/;

function fragmentWidget(
  rendered: { html: string; inline: boolean },
  docPath: () => string | null,
) {
  return (view: EditorView, getPos: () => number | undefined) => {
    // Inline fragments stay in their line; only block-level content becomes its
    // own block, as on GitHub.
    const el = document.createElement(rendered.inline ? "span" : "div");
    el.className = rendered.inline
      ? "raw-html-rendered raw-html-rendered-inline"
      : "raw-html-rendered";
    el.innerHTML = rendered.html;
    // An <img src="pic.png"> means the file beside the document, as in Typora.
    el.querySelectorAll<HTMLImageElement>("img:not(.html-svg)").forEach((img) =>
      showDocImage(img, img.getAttribute("src") ?? "", docPath()),
    );
    caretToSourceOnClick(el, view, getPos, inSummary);
    return el;
  };
}

const COMMENT_RE = /^(\s*<!--\s*)([\s\S]*?)(\s*-->\s*)$/;

/** For an HTML node that is one whole comment: the offsets of its body,
 *  without the markers and surrounding blank lines. Null otherwise. */
export function commentParts(
  text: string,
): { bodyFrom: number; bodyTo: number } | null {
  const match = COMMENT_RE.exec(text);
  // "<!-- a --> <b>x</b> <!-- b -->" isn't one comment.
  if (!match || match[2].includes("-->")) return null;
  const bodyFrom = match[1].length;
  return { bodyFrom, bodyTo: bodyFrom + match[2].length };
}

/** The href of a paired <a> open tag, as a hover title. Not checked against
 *  the sanitizer's schemes: the range gets no href, so it's never followed. */
function pairedLinkTitle(openTag: string): string | undefined {
  const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(openTag);
  const value = href?.[2] ?? href?.[3];
  return value || undefined;
}

/** A paired open tag's `style`, cut down to what the policy allows. */
function pairedStyle(openTag: string): string | null {
  const style = /\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(openTag);
  const value = style?.[2] ?? style?.[3];
  return value ? sanitizeStyle(value) : null;
}

const SVG_OPEN_RE = /^<svg[\s>]/i;
const SVG_CLOSE_RE = /^<\/svg\s*>$/i;
const selfClosed = (tag: string) => /\/>$/.test(tag);

/**
 * An SVG inside a line of text arrives as one HTML node per tag. Each run
 * from <svg> to its </svg> is one picture; the nodes a run spans are left
 * out of `rest`.
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
  handled: ReadonlySet<number>,
) {
  const all: HtmlChild[] = [];
  block.forEach((child, offset) => {
    const from = blockPos + 1 + offset;
    // A <details> split around markdown is drawn by decorateDetails.
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
      // No matching open: the stray close tag stays visible raw text.
      if (openIdx >= 0) {
        pairs.push({ tag, open: stack[openIdx].item, close: item });
        stack.length = openIdx;
      }
      continue;
    }
    // Anything else (a void tag, a self-contained fragment, a block of HTML)
    // renders as a widget below.
    fragments.push(item);
  }

  for (const { tag, open, close } of pairs) {
    // The caret on either tag reveals both. Both are asked unconditionally:
    // each is a range a caret move can flip.
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
    if (close.from <= open.to) continue;
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
      // A note to the reader of the source, which the sanitizer would drop: shown
      // as a quiet note, its markers back under the caret.
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
    // Not whitelisted: the raw text stays visible.
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
        // Kept across rebuilds while the text is the same, so an opened <details>
        // stays open.
        widgetSpec(`${docPath() ?? ""}\n${item.text}`),
      ),
    );
  }
}

const isTextblock = (node: ProseNode) => node.isTextblock;

/** Raw HTML drawn per textblock; `handled` holds the HTML nodes a
 *  <details> fold draws instead. */
function textblockReveal(
  docPath: () => string | null,
  handled: ReadonlySet<number> = new Set(),
): Reveal {
  return {
    match: isTextblock,
    decorate(node, pos, touches) {
      const decorations: Decoration[] = [];
      decorateTextblock(node, pos, touches, decorations, docPath, handled);
      return decorations;
    },
    // Part of the widgets' keys, and where a relative <img> is found.
    config: docPath,
  };
}

/** Everything drawn: the folds, then each textblock. */
function drawAll(
  state: EditorState,
  docPath: () => string | null,
  open: OpenStates,
): RawHtmlPreviewState {
  const spans = findDetailsSpans(state.doc);
  const handled = new Set<number>();
  const reveal = revealAll(
    state,
    textblockReveal(docPath, handled),
    (touches, decorations) =>
      decorateDetails(state, spans, open, touches, decorations, handled),
  );
  return { reveal, open, spans };
}

const isHtml = (node: ProseNode | null | undefined) =>
  node?.type.name === "html";

/**
 * Left and Right across inline HTML, one character a press. A hidden tag
 * has no caret position at its edge for the browser to stop on, and a shown
 * one has two drawn as one spot, so each step is taken here.
 */
function arrowOntoHtml(view: EditorView, event: KeyboardEvent): boolean {
  const step =
    event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
  if (!step || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)
    return false;
  const state = stateWithLiveSelection(view);
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const target = htmlStep(state.doc.resolve($from.pos), step);
  if (target === null) return false;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)));
  return true;
}

/** Where one character's step from `$pos` lands when HTML is in the way;
 *  null to leave it to the browser. */
function htmlStep($pos: ResolvedPos, step: 1 | -1): number | null {
  const pos = $pos.pos;
  const ahead = step === 1 ? $pos.nodeAfter : $pos.nodeBefore;
  if (isHtml($pos.parent)) {
    // At the tag's inside edge: out, and one character on.
    const atEdge =
      step === 1
        ? $pos.parentOffset === $pos.parent.content.size
        : $pos.parentOffset === 0;
    if (!atEdge) return null;
    const $out = $pos.doc.resolve(step === 1 ? $pos.after() : $pos.before());
    const next = step === 1 ? $out.nodeAfter : $out.nodeBefore;
    return next?.isText ? $out.pos + step : $out.pos;
  }
  if (!$pos.parent.inlineContent) return null;
  // Right against a tag (its source showing): into it, one character on.
  if (isHtml(ahead)) return ahead!.content.size ? pos + 2 * step : null;
  // A character away from a tag: onto its edge.
  const behind = step === 1 ? $pos.nodeBefore : $pos.nodeAfter;
  if (isHtml(behind) || !ahead?.isText) return null;
  const $target = $pos.doc.resolve(pos + step);
  const beyond = step === 1 ? $target.nodeAfter : $target.nodeBefore;
  return isHtml(beyond) ? pos + step : null;
}

export function createRawHtmlPreviewPlugin(
  options: {
    /** The open document's path, for an <img> with a relative src. */
    docPath?: () => string | null;
  } = {},
) {
  const docPath = options.docPath ?? (() => null);
  // No textblock in this reveal is a fold's: a change that could touch a fold
  // draws everything again.
  const blockReveal = textblockReveal(docPath);
  return $prose(
    () =>
      new Plugin<RawHtmlPreviewState>({
        key: rawHtmlPreviewKey,
        state: {
          init: (_config, state) => drawAll(state, docPath, new Map()),
          apply: (tr, prev, oldState, newState) => {
            let open = mapOpen(prev.open, tr);
            const toggle = tr.getMeta(rawHtmlPreviewKey) as
              FoldMeta | undefined;
            if (toggle) {
              open = new Map(open);
              for (const [pos, value] of toggle.set) open.set(pos, value);
            }
            if (toggle || docPath() !== prev.reveal.config)
              return drawAll(newState, docPath, open);
            if (!tr.docChanged && !tr.selectionSet) return prev;
            const { mapped, blocks } = revealChanges(
              tr,
              prev.reveal,
              oldState,
              newState,
            );
            const spans = tr.docChanged
              ? mapSpans(prev.spans, tr.mapping)
              : prev.spans;
            if (
              blocks.some(([from, to]) =>
                detailsTouched(newState.doc, spans, from, to),
              )
            )
              return drawAll(newState, docPath, open);
            const reveal = redrawReveal(mapped, newState, blocks, blockReveal);
            return reveal === prev.reveal && open === prev.open
              ? prev
              : { reveal, open, spans };
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
          handleKeyDown: (view, event) =>
            arrowIntoHtmlBlock(view, event) || arrowOntoHtml(view, event),
          handleDOMEvents: unfoldEventHandlers,
        },
      }),
  );
}
