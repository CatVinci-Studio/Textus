import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import { decorateAll, redecorateChanged } from "../changed-ranges";

/** On a code block whose lines are numbered: a gutter beside its lines,
 *  each number as tall as its line (gutter-fit.ts, milkdown-theme.css).
 *  The export takes it off again (export/exporters.ts). */
export const CODE_LINE_NUMBERS_CLASS = "code-block-numbered";

/** What the code block's view looks for among its decorations. */
export const LINE_NUMBERS_SPEC = "codeLineNumbers";

interface LineNumbersState {
  enabled: boolean;
  set: DecorationSet;
}

const key = new PluginKey<LineNumbersState>("code-line-numbers");

const isCodeBlock = (node: ProseNode) => node.type.name === "code_block";

const numbered = (node: ProseNode, pos: number) => [
  Decoration.node(
    pos,
    pos + node.nodeSize,
    { class: CODE_LINE_NUMBERS_CLASS },
    { [LINE_NUMBERS_SPEC]: true },
  ),
];

/**
 * Settings › Editor & Appearance › Line numbers in code blocks: marks each
 * code block with a node decoration, which its view
 * (code-block-language-view.ts) answers with a gutter of line numbers. Off
 * (the default) there is nothing to draw, and the blocks are as they were.
 * The setting is read on every transaction; MilkdownEditor sends an empty
 * one when it changes.
 */
export function createCodeLineNumbersPlugin(options: {
  enabled: () => boolean;
}) {
  return $prose(
    () =>
      new Plugin<LineNumbersState>({
        key,
        state: {
          init: (_config, state) => {
            const enabled = options.enabled();
            return {
              enabled,
              set: enabled
                ? decorateAll(state.doc, isCodeBlock, numbered)
                : DecorationSet.empty,
            };
          },
          apply(tr, prev, _oldState, state) {
            const enabled = options.enabled();
            if (enabled !== prev.enabled)
              return {
                enabled,
                set: enabled
                  ? decorateAll(state.doc, isCodeBlock, numbered)
                  : DecorationSet.empty,
              };
            if (!enabled || !tr.docChanged) return prev;
            return {
              enabled,
              set: redecorateChanged(prev.set, tr, isCodeBlock, numbered),
            };
          },
        },
        props: {
          decorations: (state) => key.getState(state)?.set,
        },
      }),
  );
}
