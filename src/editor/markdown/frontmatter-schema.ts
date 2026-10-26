import type { RemarkPluginRaw } from "@milkdown/kit/transformer";
import { $nodeSchema, $remark } from "@milkdown/kit/utils";
import remarkFrontmatter from "remark-frontmatter";

/**
 * A leading "---\n...\n---" block as yaml frontmatter, not a setext heading.
 * The explicit "yaml" preset matters: omitted, remark-frontmatter throws on
 * every parse and blanks the editor.
 */
export const remarkFrontmatterPlugin = $remark(
  "remark-frontmatter",
  () => remarkClosedFrontmatter,
  "yaml",
);

/** A file that opens with front matter: a `---` line, and another below. */
const CLOSED_FRONTMATTER =
  /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

/**
 * remark-frontmatter, used only on a file whose front matter is closed: an
 * unclosed first-line `---` made it read the rest of the file without
 * lists or quotes.
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

/** Deliberately plain: raw text in a visually distinct box. */
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
      // node.textContent: an edit can leave several text nodes, and reading only
      // the first would drop the rest of the YAML on save.
      state.addNode("yaml", undefined, node.textContent);
    },
  },
}));
