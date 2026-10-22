import type { RemarkPluginRaw } from "@milkdown/kit/transformer";
import { $nodeSchema, $remark } from "@milkdown/kit/utils";
import remarkFrontmatter from "remark-frontmatter";

/**
 * Recognizes a leading "---\n...\n---" block as a single yaml frontmatter
 * mdast node instead of letting commonmark misparse it as a setext heading
 * (a bare "---" line right after text turns the preceding paragraph into an
 * h2). remark-frontmatter's own syntax extension only matches at the very
 * start of the document, so no extra positional enforcement is needed here.
 */
// The explicit "yaml" preset matters: $remark defaults omitted options to
// {}, which remark-frontmatter reads as a matter definition and throws
// "Missing `type` in matter" on every parse - blanking the whole editor.
export const remarkFrontmatterPlugin = $remark(
  "remark-frontmatter",
  () => remarkClosedFrontmatter,
  "yaml",
);

/** A file that opens with front matter: a `---` line, and another below. */
const CLOSED_FRONTMATTER =
  /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

/**
 * remark-frontmatter, used only on a file whose front matter is closed.
 * Its syntax reads a first-line `---` as the start of front matter until
 * the end of the file, and fails there when no `---` closes it, but by
 * then the lines it ran over were read without lists or quotes: in a file
 * that opens with a rule, every `1. item`, `- item` and `> quote` came out
 * as a paragraph of text, and was saved escaped as one once edited.
 */
const remarkClosedFrontmatter: RemarkPluginRaw<string> = function (
  this: ThisParameterType<RemarkPluginRaw<string>>,
  options: string,
) {
  remarkFrontmatter.call(this, options as "yaml");
  const extensions = this.data().micromarkExtensions!;
  const syntax = extensions.at(-1)!;
  const parse = this.parser!;
  this.parser = (document, file) => {
    if (CLOSED_FRONTMATTER.test(document)) return parse(document, file);
    const at = extensions.indexOf(syntax);
    extensions.splice(at, 1);
    try {
      return parse(document, file);
    } finally {
      extensions.splice(at, 0, syntax);
    }
  };
};

/**
 * Deliberately plain: raw text content, no language selector or collapse
 * toggle (unlike code-block-language-view.ts / mermaid-plugin.ts) - just a
 * visually distinct box via CSS (see .frontmatter-block in
 * milkdown-theme.css) so it doesn't get mistaken for document body text.
 */
export const frontmatterSchema = $nodeSchema("frontmatter", () => ({
  content: "text*",
  group: "block",
  marks: "",
  code: true,
  defining: true,
  isolating: true,
  attrs: {},
  parseDOM: [
    { tag: 'div[data-type="frontmatter"]', preserveWhitespace: "full" },
  ],
  toDOM: () => [
    "div",
    { "data-type": "frontmatter", class: "frontmatter-block" },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === "yaml",
    runner: (state, node, type) => {
      state.openNode(type);
      if (node.value) state.addText(node.value as string);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "frontmatter",
    runner: (state, node) => {
      // node.textContent (not content.firstChild?.text) - a paste or edit
      // can leave the "text*" content as more than one text node, and only
      // reading the first would silently drop the rest of the YAML on save.
      state.addNode("yaml", undefined, node.textContent);
    },
  },
}));
