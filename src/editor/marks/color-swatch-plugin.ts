import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import {
  changedRanges,
  decorateAll,
  redecorateChanged,
} from "../changed-ranges";
import { colorOfCode, findColorCodes, OPAQUE } from "./color-codes";
import { COMPOSE_RELOCATE_DELAY_MS } from "./enclosure";

/** The swatch's element in inline code, editor chrome the export and print
 *  drop. */
export const COLOR_SWATCH_CLASS = "color-swatch";
/** The first character of a colour code in plain text, which draws the
 *  swatch before itself (::before); the export unwraps it. */
export const COLOR_SWATCH_TEXT_CLASS = "color-swatch-text";

interface SwatchState {
  enabled: boolean;
  set: DecorationSet;
  /** What an IME composition changed, drawn once it ends. */
  pending: [number, number][];
}

const key = new PluginKey<SwatchState>("color-swatch");

/** A block whose text can hold colour codes: not a code block, front
 *  matter or block math. */
const isTextBlock = (node: ProseNode) =>
  node.isTextblock && !node.type.spec.code;

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

/** A stretch of the block's own text: at `pos` in the document, at
 *  `start` in the string findColorCodes reads. */
interface Run {
  start: number;
  pos: number;
  length: number;
}

/**
 * The block's swatches. Its text is read as one string, so whether a code
 * stands as a token of its own is judged by what really stands beside it,
 * across bold or italic. Only the block's own text can hold a code: a
 * link's text (an autolinked URL among them) is read but never matched,
 * and inline code, wikilinks, math, images and raw HTML read as OPAQUE.
 * Inline code gets its own swatch, as before, when all of it is a colour.
 */
function swatches(block: ProseNode, blockPos: number): Decoration[] {
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
  for (const code of findColorCodes(text)) {
    const run = runs.find(
      (r) => r.start <= code.from && code.to <= r.start + r.length,
    );
    if (!run) continue;
    const from = run.pos + code.from - run.start;
    // One character, which no other decoration (a find match) can split
    // into pieces that each draw a swatch.
    decorations.push(
      Decoration.inline(
        from,
        from + 1,
        {
          class: COLOR_SWATCH_TEXT_CLASS,
          style: `--color-swatch: ${code.color}`,
        },
        { color: code.color },
      ),
    );
  }
  return decorations;
}

function build(doc: ProseNode, enabled: boolean): SwatchState {
  return {
    enabled,
    set: enabled
      ? decorateAll(doc, isTextBlock, swatches)
      : DecorationSet.empty,
    pending: [],
  };
}

/** `set` with the text blocks around `ranges` - what an IME composition
 *  changed - drawn again, once it has ended. */
function redrawAround(
  set: DecorationSet,
  doc: ProseNode,
  ranges: [number, number][],
): DecorationSet {
  const drawn = new Set<number>();
  const stale: Decoration[] = [];
  const fresh: Decoration[] = [];
  const size = doc.content.size;
  for (const [from, to] of ranges)
    doc.nodesBetween(
      Math.max(0, from - 1),
      Math.min(size, to + 1),
      (node, pos) => {
        if (!isTextBlock(node)) return true;
        if (!drawn.has(pos)) {
          drawn.add(pos);
          stale.push(...set.find(pos, pos + node.nodeSize));
          fresh.push(...swatches(node, pos));
        }
        return false;
      },
    );
  return set.remove(stale).add(doc, fresh);
}

/** The plugin itself, for tests; the editor uses createColorSwatchPlugin. */
export function colorSwatchPlugin(enabled: () => boolean): Plugin {
  return new Plugin<SwatchState>({
    key,
    state: {
      init: (_config, state) => build(state.doc, enabled()),
      apply(tr, prev, _oldState, state) {
        const on = enabled();
        if (on !== prev.enabled) return build(state.doc, on);
        if (!on) return prev;
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
                enabled: on,
                set: prev.set.map(tr.mapping, tr.doc),
                pending: [...pending, ...changedRanges(tr)],
              }
            : prev;
        if (!tr.docChanged && !pending.length) return prev;
        let set = redecorateChanged(prev.set, tr, isTextBlock, swatches);
        if (pending.length) set = redrawAround(set, tr.doc, pending);
        return { enabled: on, set, pending: [] };
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
 * Settings › Editor & Appearance › Colour swatches (#146), off by default:
 * a small square of the colour before a colour code - `#ff8800` or
 * `rgb(0 128 255)` written in a paragraph, heading, list item or table
 * cell, or inline code that is one colour. Fenced code stays as written.
 * Decorations only, never text: nothing of them is saved, copied or
 * exported. Redrawn per block around what an edit touched; MilkdownEditor
 * sends an empty transaction when the setting changes.
 */
export function createColorSwatchPlugin(options: { enabled: () => boolean }) {
  return $prose(() => colorSwatchPlugin(options.enabled));
}
