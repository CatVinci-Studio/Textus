import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import {
  applyReveal,
  revealAll,
  type Reveal,
  type RevealState,
  type Touches,
} from "../../editor/reveal-state";
import {
  onPluginSyntaxes,
  pluginSyntaxes,
  type PluginSyntax,
} from "../../plugins/contributions/syntax";
import "./plugin-syntax.css";

/**
 * Plugins' inline syntax shown as it means: the words in its `text` group
 * styled, the rest of the match hidden until the caret touches it. The text
 * itself never changes.
 */

const key = new PluginKey<RevealState>("plugin-syntax");

/** Text longer than this in one run is left as written. */
const LONGEST_RUN = 20_000;
/** Matches drawn in one run at most. */
const MOST_MATCHES = 200;

interface SyntaxMatch {
  from: number;
  to: number;
  /** The words shown, styled; the whole match without a `text` group. */
  shown: [number, number];
  /** Its `note` group's words: what ruby sets above them. */
  note?: string;
  syntax: PluginSyntax;
}

/** A match of a pattern with the `d` flag: where it and its groups are. */
type Placed = RegExpExecArray & {
  indices: [number, number][] & {
    groups?: Record<string, [number, number] | undefined>;
  };
};

/** Each syntax's matches in `text`, in order; one already taken by an
 *  earlier match (or syntax) isn't drawn twice. */
export function syntaxMatches(
  text: string,
  syntaxes: readonly PluginSyntax[],
): SyntaxMatch[] {
  if (text.length > LONGEST_RUN) return [];
  const found: SyntaxMatch[] = [];
  for (const syntax of syntaxes) {
    const { pattern } = syntax;
    pattern.lastIndex = 0;
    let count = 0;
    for (
      let m = pattern.exec(text) as Placed | null;
      m;
      m = pattern.exec(text) as Placed | null
    ) {
      if (m[0] === "") {
        pattern.lastIndex++;
        continue;
      }
      if (++count > MOST_MATCHES) break;
      const [from, to] = m.indices[0];
      if (found.some((f) => f.from < to && from < f.to)) continue;
      const shown = m.indices.groups?.text ?? [from, to];
      if (shown[1] <= shown[0]) continue;
      found.push({ from, to, shown, note: m.groups?.note, syntax });
    }
  }
  return found.sort((a, b) => a.from - b.from);
}

/** The block's runs of plain text: unbroken by an inline node or code. */
function textRuns(block: ProseNode, pos: number) {
  const runs: { at: number; text: string }[] = [];
  let run: { at: number; text: string } | null = null;
  block.forEach((child, offset) => {
    const plain =
      child.isText && !child.marks.some((mark) => mark.type.spec.code);
    if (!plain) {
      run = null;
      return;
    }
    if (!run) runs.push((run = { at: pos + 1 + offset, text: "" }));
    run.text += child.text ?? "";
  });
  return runs;
}

const hiddenClass = (touched: boolean) =>
  touched ? "plugin-syntax-source" : "plugin-syntax-hidden";

function draw(at: number, match: SyntaxMatch, touched: boolean) {
  const { from, to, shown, syntax } = match;
  const out: Decoration[] = [];
  const hide = (a: number, b: number) => {
    if (b > a)
      out.push(
        Decoration.inline(at + a, at + b, {
          class: hiddenClass(touched),
          "data-editor-mark": "",
        }),
      );
  };
  hide(from, shown[0]);
  const attrs: Record<string, string> = {
    class: `plugin-syntax plugin-syntax-${syntax.style} plugin-tone-${syntax.tone}${
      touched ? " is-touched" : ""
    }`,
    "data-editor-mark": "",
  };
  if (syntax.style === "ruby" && match.note && !touched)
    attrs["data-ruby"] = match.note;
  out.push(Decoration.inline(at + shown[0], at + shown[1], attrs));
  hide(shown[1], to);
  return out;
}

function decorate(block: ProseNode, pos: number, touches: Touches) {
  const syntaxes = pluginSyntaxes();
  if (!syntaxes.length || block.type.spec.code) return [];
  const out: Decoration[] = [];
  for (const { at, text } of textRuns(block, pos))
    for (const match of syntaxMatches(text, syntaxes))
      out.push(...draw(at, match, touches(at + match.from, at + match.to)));
  return out;
}

const reveal: Reveal = {
  match: (node) => node.isTextblock,
  decorate,
  config: pluginSyntaxes,
};

/** Plugins' inline syntax, drawn in every editor and read-only view. */
export const pluginSyntax = $prose(
  () =>
    new Plugin<RevealState>({
      key,
      state: {
        init: (_config, state) => revealAll(state, reveal),
        apply: (tr, prev, oldState, newState) =>
          applyReveal(tr, prev, oldState, newState, reveal),
      },
      props: { decorations: (state) => key.getState(state)?.set },
      // A plugin adding or taking away a syntax redraws the document.
      view: (view) => ({
        destroy: onPluginSyntaxes(() => {
          if (!view.isDestroyed) view.dispatch(view.state.tr);
        }),
      }),
    }),
);
