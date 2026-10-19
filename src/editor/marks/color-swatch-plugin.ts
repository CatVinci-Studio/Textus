import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import { decorateAll, redecorateChanged } from "../changed-ranges";

/** The swatch's element, editor chrome the export and print drop. */
export const COLOR_SWATCH_CLASS = "color-swatch";

// Plain numbers only - the same idea as raw HTML's style check
// (html/html-policy.ts), stricter: the whole text must be one colour in a
// form that names it outright, so `red` or `currentColor` stay plain code.
const NUM = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`;
const PCT = `${NUM}%`;
const NUM_OR_PCT = `${NUM}%?`;
const HUE = `${NUM}(?:deg|grad|rad|turn)?`;
const COLOR_FORMS = [
  "#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})",
  // rgb(1, 2, 3) / rgba(1, 2, 3, .5) and rgb(1 2 3 / 50%)
  String.raw`rgba?\(\s*${NUM_OR_PCT}\s*,\s*${NUM_OR_PCT}\s*,\s*${NUM_OR_PCT}\s*(?:,\s*${NUM_OR_PCT}\s*)?\)`,
  String.raw`rgba?\(\s*${NUM_OR_PCT}\s+${NUM_OR_PCT}\s+${NUM_OR_PCT}\s*(?:\/\s*${NUM_OR_PCT}\s*)?\)`,
  // hsl(120, 50%, 50%) / hsla(...) and hsl(120deg 50% 50% / .5)
  String.raw`hsla?\(\s*${HUE}\s*,\s*${PCT}\s*,\s*${PCT}\s*(?:,\s*${NUM_OR_PCT}\s*)?\)`,
  String.raw`hsla?\(\s*${HUE}\s+${NUM_OR_PCT}\s+${NUM_OR_PCT}\s*(?:\/\s*${NUM_OR_PCT}\s*)?\)`,
];
const COLOR_RE = new RegExp(`^(?:${COLOR_FORMS.join("|")})$`, "i");

/** The colour inline code's text is, when a swatch can show it: hex,
 *  rgb()/rgba() or hsl()/hsla() - never a bare keyword. Else null. */
export function colorOfCode(text: string): string | null {
  const value = text.trim();
  if (!COLOR_RE.test(value)) return null;
  // The pattern lets through a few the browser refuses (percentages and
  // numbers mixed in the comma form); it has the last word where it can
  // be asked.
  if (
    typeof CSS !== "undefined" &&
    CSS.supports &&
    !CSS.supports("color", value)
  )
    return null;
  return value;
}

interface SwatchState {
  enabled: boolean;
  set: DecorationSet;
}

const key = new PluginKey<SwatchState>("color-swatch");

const isCodeSpan = (node: ProseNode) => node.type.name === "md_code_span";

function swatch(node: ProseNode, pos: number): Decoration[] {
  const color = colorOfCode(node.textContent);
  if (!color) return [];
  return [
    // Inside the span, before its text: the caret's way across a span is
    // enclosure.ts's (it hops between outside and inside on its own), so
    // no native caret move ever has to step over this element. Before the
    // span, in the paragraph, it sat in the native step to and from the
    // text before - where WebKit stalls on uneditable content.
    Decoration.widget(
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
    ),
  ];
}

function build(doc: ProseNode, enabled: boolean): SwatchState {
  return {
    enabled,
    set: enabled ? decorateAll(doc, isCodeSpan, swatch) : DecorationSet.empty,
  };
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
        if (!on || !tr.docChanged) return prev;
        return {
          enabled: on,
          set: redecorateChanged(prev.set, tr, isCodeSpan, swatch),
        };
      },
    },
    props: {
      decorations: (state) => key.getState(state)?.set,
    },
  });
}

/**
 * Settings › Editor & Appearance › Colour swatches (#146), off by default:
 * a small square of the colour before the text of inline code that is a
 * colour, `#ff8800` or `rgb(0 128 255)` - the code itself keeps its look.
 * Decorations only, redrawn around what an edit touched; MilkdownEditor
 * sends an empty transaction when the setting changes.
 */
export function createColorSwatchPlugin(options: { enabled: () => boolean }) {
  return $prose(() => colorSwatchPlugin(options.enabled));
}
