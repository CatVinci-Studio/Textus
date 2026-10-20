import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import {
  changedRanges,
  decorateAll,
  redecorateChanged,
  redrawBlocks,
  touchedBlocks,
} from "../changed-ranges";
import type { ColorSwatchMode } from "../../settings/SettingsContext";
import { commentRanges } from "../code/code-comments";
import { colorOfCode, findColorCodes, OPAQUE } from "./color-codes";
import {
  COLOR_SWATCH_CLASS,
  COLOR_SWATCH_TEXT_CLASS,
} from "./color-swatch-classes";
import { COMPOSE_RELOCATE_DELAY_MS } from "./enclosure";

interface SwatchState {
  mode: ColorSwatchMode;
  set: DecorationSet;
  /** What an IME composition changed, drawn once it ends. */
  pending: [number, number][];
}

const key = new PluginKey<SwatchState>("color-swatch");

/** A block whose text can hold colour codes: a code block, or one that
 *  isn't code at all - not front matter or block math. */
const isSwatchBlock = (node: ProseNode) =>
  node.isTextblock && (!node.type.spec.code || node.type.name === "code_block");

function codeSwatch(color: string, pos: number): Decoration {
  // Inside the span, before its text: the caret's way across a span is
  // enclosure.ts's (it hops between outside and inside on its own), so
  // no native caret move ever has to step over this element. Before the
  // span, in the paragraph, it sat in the native step to and from the
  // text before - where WebKit stalls on uneditable content.
  return Decoration.widget(
    pos + 1,
    () => {
      const el = document.createElement("span");
      el.className = COLOR_SWATCH_CLASS;
      el.contentEditable = "false";
      el.setAttribute("aria-hidden", "true");
      el.style.setProperty("--color-swatch", color);
      return el;
    },
    { side: -1, key: `swatch:${color}`, ignoreSelection: true },
  );
}

// One character, which no other decoration (a find match, a syntax
// token) can split into pieces that each draw a swatch.
const textSwatch = (from: number, color: string) =>
  Decoration.inline(
    from,
    from + 1,
    { class: COLOR_SWATCH_TEXT_CLASS, style: `--color-swatch: ${color}` },
    { color },
  );

/** A stretch of the block's own text: at `pos` in the document, at
 *  `start` in the string findColorCodes reads. */
interface Run {
  start: number;
  pos: number;
  length: number;
}

/**
 * A block's swatches, for a mode that isn't "off". A code block's colour
 * literals outside its comments, short hex included. Inline code that is
 * all one colour.
 * With "everywhere", also the colour codes in the block's text, read as
 * one string, so whether a code stands as a token of its own is judged by
 * what really stands beside it, across bold or italic. Only the block's
 * own text can hold one: a link's text (an autolinked URL among them) is
 * read but never matched, and inline code, wikilinks, math, images and
 * raw HTML read as OPAQUE.
 */
function swatches(
  mode: ColorSwatchMode,
  block: ProseNode,
  blockPos: number,
): Decoration[] {
  if (block.type.name === "code_block") {
    // Not in comments, where `see #234` is an issue, not a grey.
    const comments = commentRanges(
      block.textContent,
      block.attrs.language as string | null,
    );
    return findColorCodes(block.textContent, true)
      .filter(({ from }) => !comments.some(([a, b]) => a <= from && from < b))
      .map((code) => textSwatch(blockPos + 1 + code.from, code.color));
  }
  const decorations: Decoration[] = [];
  const runs: Run[] = [];
  let text = "";
  const read = (parent: ProseNode, contentPos: number) =>
    parent.forEach((child, offset) => {
      const pos = contentPos + offset;
      if (child.isText) {
        const linked = child.marks.some((m) => m.type.name === "link");
        if (!linked)
          runs.push({ start: text.length, pos, length: child.nodeSize });
        text += child.text;
      } else if (child.type.name === "md_span") {
        read(child, pos + 1);
      } else {
        if (child.type.name === "md_code_span") {
          const color = colorOfCode(child.textContent);
          if (color) decorations.push(codeSwatch(color, pos));
        }
        text += child.type.name === "hardbreak" ? "\n" : OPAQUE;
      }
    });
  read(block, blockPos + 1);
  if (mode !== "everywhere") return decorations;
  for (const code of findColorCodes(text)) {
    const run = runs.find(
      (r) => r.start <= code.from && code.to <= r.start + r.length,
    );
    if (run)
      decorations.push(textSwatch(run.pos + code.from - run.start, code.color));
  }
  return decorations;
}

function build(doc: ProseNode, mode: ColorSwatchMode): SwatchState {
  return {
    mode,
    set:
      mode === "off"
        ? DecorationSet.empty
        : decorateAll(doc, isSwatchBlock, (node, pos) =>
            swatches(mode, node, pos),
          ),
    pending: [],
  };
}

/** `set` with the blocks around `ranges` - what an IME composition
 *  changed - drawn again, once it has ended. */
function redrawAround(
  mode: ColorSwatchMode,
  set: DecorationSet,
  doc: ProseNode,
  ranges: [number, number][],
): DecorationSet {
  return redrawBlocks(
    set,
    doc,
    touchedBlocks(doc, ranges),
    isSwatchBlock,
    (n, p) => swatches(mode, n, p),
  );
}

/** The plugin itself, for tests; the editor uses createColorSwatchPlugin. */
export function colorSwatchPlugin(mode: () => ColorSwatchMode): Plugin {
  return new Plugin<SwatchState>({
    key,
    state: {
      init: (_config, state) => build(state.doc, mode()),
      apply(tr, prev, _oldState, state) {
        const now = mode();
        if (now !== prev.mode) return build(state.doc, now);
        if (now === "off") return prev;
        const pending = prev.pending.map(([from, to]): [number, number] => [
          tr.mapping.map(from, -1),
          tr.mapping.map(to, 1),
        ]);
        // A swatch drawn or dropped mid-composition splits or joins the
        // text node the IME is writing into (the swatch's character is a
        // <span> of its own), which aborts or doubles the preedit on
        // WebKitGTK; what the composition changes waits for its end.
        if (tr.getMeta("composition"))
          return tr.docChanged
            ? {
                mode: now,
                set: prev.set.map(tr.mapping, tr.doc),
                pending: [...pending, ...changedRanges(tr)],
              }
            : prev;
        if (!tr.docChanged && !pending.length) return prev;
        let set = redecorateChanged(prev.set, tr, isSwatchBlock, (node, pos) =>
          swatches(now, node, pos),
        );
        if (pending.length) set = redrawAround(now, set, tr.doc, pending);
        return { mode: now, set, pending: [] };
      },
    },
    props: {
      decorations: (state) => key.getState(state)?.set,
      handleDOMEvents: {
        compositionend(view) {
          // Once prosemirror-view has read the committed text back in.
          setTimeout(() => {
            if (view.composing || view.isDestroyed) return;
            if (key.getState(view.state)?.pending.length)
              view.dispatch(view.state.tr.setMeta(key, "flush"));
          }, COMPOSE_RELOCATE_DELAY_MS + 10);
          return false;
        },
      },
    },
  });
}

/**
 * Settings › Editor & Appearance › Swatches before colour codes (#146),
 * off by default: a small square of the colour before a colour code. "In
 * code only" draws it in inline code that is one colour and before the
 * colour literals of code blocks; "Everywhere" also before `#ff8800` or
 * `rgb(0 128 255)` written in a paragraph, heading, list item or table
 * cell. Decorations only, never text: nothing of them is saved, copied or
 * exported. Redrawn per block around what an edit touched; MilkdownEditor
 * sends an empty transaction when the setting changes.
 */
export function createColorSwatchPlugin(options: {
  mode: () => ColorSwatchMode;
}) {
  return $prose(() => colorSwatchPlugin(options.mode));
}
