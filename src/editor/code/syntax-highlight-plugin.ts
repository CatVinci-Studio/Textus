import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { createParser } from "prosemirror-highlight/refractor";
import { refractor } from "refractor";
import { decorateAll, redecorateChanged } from "../changed-ranges";

// The default export bundles the ~40 most common languages, not the full
// ~300-language build.
const highlight = createParser(refractor);

const isCodeBlock = (node: ProseNode) => node.type.name === "code_block";

// A fence without a language, or in one refractor doesn't bundle (mermaid,
// a typo, an exotic one), stays plain: passed through, refractor throws.
function tokens(node: ProseNode, pos: number): Decoration[] {
  const language = node.attrs.language as string | null;
  if (!language || !refractor.registered(language)) return [];
  return highlight({
    content: node.textContent,
    language,
    pos,
    size: node.nodeSize,
  }) as Decoration[];
}

const key = new PluginKey<DecorationSet>("syntax-highlight");

/**
 * Code blocks' syntax colours. Not prosemirror-highlight's own plugin, which
 * retokenized every block on every edit; only touched blocks are redone here.
 */
export const syntaxHighlightPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key,
      state: {
        init: (_config, state) => decorateAll(state.doc, isCodeBlock, tokens),
        apply: (tr, set) =>
          tr.docChanged ? redecorateChanged(set, tr, isCodeBlock, tokens) : set,
      },
      props: {
        decorations: (state) => key.getState(state),
      },
    }),
);
