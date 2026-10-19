import { $nodeSchema, $remark, $inputRule } from "@milkdown/kit/utils";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import remarkMath from "remark-math";
import {
  displayLatexBlocks,
  latexMathFromMarkdown,
  latexMathSyntax,
} from "./latex-math-syntax";

interface MdastNode {
  type: string;
  value?: string;
  data?: Record<string, unknown>;
  children?: MdastNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/**
 * Pandoc's rule for single-dollar math, on top of remark-math (which pairs
 * any two dollars): the opening `$` needs a non-space right after it, the
 * closing one a non-space right before it and no digit right after it. So
 * "about $4) and round's $19" and "$5 and $6" stay prices, as they do in
 * Pandoc, Typora and GitHub, instead of one long italic formula. A pair
 * that breaks the rule goes back to the text it was written as.
 */
export function revertCurrencyDollars(tree: MdastNode, source: string): void {
  const walk = (node: MdastNode) => {
    if (!node.children) return;
    node.children = node.children.map((child) => {
      walk(child);
      if (child.type !== "inlineMath") return child;
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      if (start === undefined || end === undefined) return child;
      const raw = source.slice(start, end);
      if (!raw.startsWith("$") || raw.startsWith("$$")) return child;
      const inner = raw.slice(1, -1);
      const breaksRule =
        /^\s/.test(inner) || /\s$/.test(inner) || /^\d/.test(source[end] ?? "");
      return breaksRule ? { type: "text", value: raw } : child;
    });
  };
  walk(tree);
}

/**
 * Records how many dollars an inline formula was written with, as
 * `data.mathDelimiter`, when it is more than one: mdast writes the fewest
 * that work, so an inline `$$x$$` was saved as `$x$`.
 */
function recordDollarRuns(tree: MdastNode, source: string): void {
  const walk = (node: MdastNode) => {
    if (node.type === "inlineMath") {
      const start = node.position?.start.offset;
      const run = start === undefined ? "" : /^\$+/.exec(source.slice(start));
      if (run && run[0].length > 1)
        node.data = { ...node.data, mathDelimiter: run[0] };
    }
    node.children?.forEach(walk);
  };
  walk(tree);
}

/** The delimiter a math node was read with, or null for the default. */
const delimiterOf = (node: { data?: unknown }) =>
  (node.data as { mathDelimiter?: string } | undefined)?.mathDelimiter ?? null;

function remarkMathWithPandocDollars(
  this: unknown,
  ...args: Parameters<typeof remarkMath>
) {
  (remarkMath as (...a: unknown[]) => void).apply(this, args);
  const data = (this as { data: () => Record<string, unknown[]> }).data();
  (data.micromarkExtensions ??= []).push(latexMathSyntax());
  (data.fromMarkdownExtensions ??= []).push(latexMathFromMarkdown());
  return (tree: MdastNode, file: { value: unknown }) => {
    revertCurrencyDollars(tree, String(file.value));
    recordDollarRuns(tree, String(file.value));
    displayLatexBlocks(tree);
  };
}

export const remarkMathPlugin = $remark(
  "remark-math",
  () => remarkMathWithPandocDollars as unknown as typeof remarkMath,
);

export const mathInlineSchema = $nodeSchema("math_inline", () => ({
  content: "text*",
  group: "inline",
  inline: true,
  marks: "",
  // As written in the file: "$" (the default, and all the editor makes),
  // "$$" (see recordDollarRuns), or LaTeX's `\(` or `\[` (see
  // latex-math-syntax.ts).
  attrs: { delimiter: { default: "$", validate: "string" } },
  parseDOM: [
    {
      tag: 'span[data-type="math_inline"]',
      getAttrs: (dom) => ({
        delimiter: (dom as HTMLElement).dataset.delimiter || "$",
      }),
    },
  ],
  toDOM: (node) => [
    "span",
    {
      "data-type": "math_inline",
      class: "math-inline",
      ...(node.attrs.delimiter === "$"
        ? {}
        : { "data-delimiter": node.attrs.delimiter as string }),
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === "inlineMath",
    // Added whole, like inline code (md-span-schema.ts): closeNode would
    // drop a surrounding link for the text after the formula.
    runner: (state, node, type) => {
      const value = node.value as string | undefined;
      const delimiter = delimiterOf(node);
      state.addNode(
        type,
        delimiter ? { delimiter } : undefined,
        value ? [state.schema.text(value)] : [],
      );
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "math_inline",
    runner: (state, node) => {
      const delimiter = node.attrs.delimiter as string;
      state.addNode(
        "inlineMath",
        undefined,
        node.content.firstChild?.text || "",
        delimiter === "$" ? undefined : { data: { mathDelimiter: delimiter } },
      );
    },
  },
}));

export const mathBlockSchema = $nodeSchema("math_block", () => ({
  content: "text*",
  group: "block",
  marks: "",
  code: true,
  defining: true,
  // "$$" (the default) or `\[` - see latex-math-syntax.ts - and, for `\[`,
  // whether it shared one line with its formula: `\[x\]`.
  attrs: {
    delimiter: { default: "$$", validate: "string" },
    oneLine: { default: false, validate: "boolean" },
  },
  parseDOM: [
    {
      tag: 'div[data-type="math_block"]',
      preserveWhitespace: "full",
      getAttrs: (dom) => ({
        delimiter: (dom as HTMLElement).dataset.delimiter || "$$",
        oneLine: (dom as HTMLElement).dataset.oneLine === "true",
      }),
    },
  ],
  // Wrapped in an outer div so the editing state (enclosure.ts's
  // .math-block-revealed, which decorates the node's OUTERMOST DOM
  // regardless of this nesting) can get its own panel styling in
  // milkdown-theme.css, independent of the inner div's white-space/content
  // handling.
  toDOM: (node) => [
    "div",
    { class: "math-block-wrapper" },
    [
      "div",
      {
        "data-type": "math_block",
        class: "math-block",
        ...(node.attrs.delimiter === "$$"
          ? {}
          : {
              "data-delimiter": node.attrs.delimiter as string,
              "data-one-line": String(node.attrs.oneLine),
            }),
      },
      0,
    ],
  ],
  parseMarkdown: {
    match: (node) => node.type === "math",
    runner: (state, node, type) => {
      const delimiter = delimiterOf(node);
      state.openNode(
        type,
        delimiter
          ? {
              delimiter,
              oneLine: Boolean(
                (node.data as { oneLine?: boolean } | undefined)?.oneLine,
              ),
            }
          : undefined,
      );
      if (node.value) state.addText(node.value as string);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "math_block",
    runner: (state, node) => {
      const delimiter = node.attrs.delimiter as string;
      state.addNode(
        "math",
        undefined,
        node.content.firstChild?.text || "",
        delimiter === "$$"
          ? undefined
          : {
              data: {
                mathDelimiter: delimiter,
                oneLine: node.attrs.oneLine as boolean,
              },
            },
      );
    },
  },
}));

// Fallback for "$formula$" arriving as a single bulk insertion (e.g. paste)
// rather than character-by-character typing - the normal typing path is
// math-autopair-plugin's "$" auto-pairing, which handles closing a pair one
// keystroke at a time and never reaches this rule.
export const mathInlineInputRule = $inputRule(
  (ctx) =>
    new InputRule(
      /(?<!\$)\$([^$\s](?:[^$]*[^$\s])?)\$$/,
      (state, match, start, end) => {
        const value = match[1];
        if (!value) return null;
        const type = mathInlineSchema.type(ctx);
        return state.tr.replaceWith(
          start,
          end,
          type.create({}, state.schema.text(value)),
        );
      },
    ),
);
