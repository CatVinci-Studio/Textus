import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, type DecorationSet } from "@milkdown/kit/prose/view";
import { createParser } from "prosemirror-highlight/refractor";
import { refractor } from "refractor";
import { decorateAll, redecorateChanged } from "../changed-ranges";
import { TOKEN_TYPES, tokenizeBlock } from "./code-grammar";
import {
  addedLanguage,
  addedLanguagesVersion,
  onAddedLanguages,
} from "./code-languages";

// The default export bundles the ~40 most common languages, not the full
// ~300-language build.
const highlight = createParser(refractor);

const isCodeBlock = (node: ProseNode) => node.type.name === "code_block";

// A language a plugin adds, coloured with the classes refractor's tokens
// carry, so the stylesheet and themes colour both alike.
function addedTokens(node: ProseNode, pos: number, language: string) {
  const added = addedLanguage(language);
  const grammar = added?.now();
  if (!added || !grammar) return [];
  const found = tokenizeBlock(grammar, node.textContent);
  if (!found) {
    added.drop();
    return [];
  }
  return found.map((t) =>
    Decoration.inline(pos + 1 + t.from, pos + 1 + t.to, {
      class: `token ${TOKEN_TYPES[t.type].prism}`,
    }),
  );
}

// A fence without a language, or in one neither refractor nor a plugin
// knows (mermaid, a typo, an exotic one), stays plain: passed through,
// refractor throws. Textus's own languages win over a plugin's.
function tokens(node: ProseNode, pos: number): Decoration[] {
  const language = node.attrs.language as string | null;
  if (!language) return [];
  if (!refractor.registered(language)) return addedTokens(node, pos, language);
  return highlight({
    content: node.textContent,
    language,
    pos,
    size: node.nodeSize,
  }) as Decoration[];
}

interface Highlights {
  set: DecorationSet;
  /** addedLanguagesVersion() when the blocks were last all coloured. */
  version: number;
}

const all = (doc: ProseNode): Highlights => ({
  version: addedLanguagesVersion(),
  set: decorateAll(doc, isCodeBlock, tokens),
});

const key = new PluginKey<Highlights>("syntax-highlight");

/**
 * Code blocks' syntax colours. Not prosemirror-highlight's own plugin, which
 * retokenized every block on every edit; only touched blocks are redone here.
 */
export const syntaxHighlightPlugin = $prose(
  () =>
    new Plugin<Highlights>({
      key,
      state: {
        init: (_config, state) => all(state.doc),
        apply: (tr, prev, _old, state) =>
          tr.getMeta(key)
            ? all(state.doc)
            : tr.docChanged
              ? {
                  ...prev,
                  set: redecorateChanged(prev.set, tr, isCodeBlock, tokens),
                }
              : prev,
      },
      props: {
        decorations: (state) => key.getState(state)?.set,
      },
      // A language added or gone, or its grammar read (maybe before this
      // view was made): every block again, as the blocks haven't changed.
      view: (view) => {
        const refresh = () => {
          if (view.isDestroyed) return;
          if (key.getState(view.state)?.version === addedLanguagesVersion())
            return;
          view.dispatch(view.state.tr.setMeta(key, true));
        };
        queueMicrotask(refresh);
        return { destroy: onAddedLanguages(refresh) };
      },
    }),
);
