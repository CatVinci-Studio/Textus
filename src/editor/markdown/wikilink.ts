import { $inputRule, $nodeSchema, $remark } from "@milkdown/kit/utils";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import type { Transaction } from "@milkdown/kit/prose/state";
import type { RemarkPluginRaw } from "@milkdown/kit/transformer";
import type {
  Extension as FromMarkdownExtension,
  Handle as FromMarkdownHandle,
} from "mdast-util-from-markdown";
import type { Options as ToMarkdownExtension } from "mdast-util-to-markdown";
import type { Literal } from "mdast";
import { WIKILINK_SOURCE } from "../../utils/note-link";
import { doubleBracketSyntax } from "./double-brackets";

/**
 * Obsidian's wikilinks (`[[Note]]`, `[[Note|text]]`, `[[Note#Heading]]`),
 * kept as written so a save doesn't escape them to `\[\[Note]]`.
 */

declare module "micromark-util-types" {
  interface TokenTypeMap {
    wikilink: "wikilink";
  }
}

/** A wikilink as mdast: `value` is its source, `[[` to `]]`. */
interface Wikilink extends Literal {
  type: "wikilink";
}

declare module "mdast" {
  interface PhrasingContentMap {
    wikilink: Wikilink;
  }
  interface RootContentMap {
    wikilink: Wikilink;
  }
}

const enterWikilink: FromMarkdownHandle = function (token) {
  this.enter({ type: "wikilink", value: this.sliceSerialize(token) }, token);
};

const exitWikilink: FromMarkdownHandle = function (token) {
  this.exit(token);
};

const wikilinkFromMarkdown: FromMarkdownExtension = {
  enter: { wikilink: enterWikilink },
  exit: { wikilink: exitWikilink },
};

const wikilinkToMarkdown: ToMarkdownExtension = {
  // Written as it was read: escaping its brackets would turn it to text.
  handlers: { wikilink: (node: Wikilink) => node.value },
};

const remarkWikilink: RemarkPluginRaw<unknown> = function (
  this: ThisParameterType<RemarkPluginRaw<unknown>>,
) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(
    doubleBracketSyntax("wikilink", { bang: false, refuseParen: true }),
  );
  (data.fromMarkdownExtensions ??= []).push(wikilinkFromMarkdown);
  (data.toMarkdownExtensions ??= []).push(wikilinkToMarkdown);
};

export const remarkWikilinkPlugin = $remark(
  "remark-wikilink",
  () => remarkWikilink,
);

export const wikilinkSchema = $nodeSchema("wikilink", () => ({
  content: "text*",
  group: "inline",
  inline: true,
  marks: "",
  // Source, like an embed: "*" typed in a note's name is not bold.
  code: true,
  attrs: {},
  parseDOM: [{ tag: 'span[data-type="wikilink"]', preserveWhitespace: "full" }],
  toDOM: () => ["span", { "data-type": "wikilink", class: "wikilink" }, 0],
  parseMarkdown: {
    match: (node) => node.type === "wikilink",
    runner: (state, node, type) => {
      state.openNode(type);
      state.addText(node.value as string);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "wikilink",
    runner: (state, node) => {
      state.addNode("wikilink", undefined, node.textContent);
    },
  },
}));

/** `[[...]]` typed as text becomes a wikilink once it closes, but not the
 *  end of an embed, `![[...]]`. */
export const wikilinkInputRule = $inputRule(
  (ctx) =>
    new InputRule(/\[\[[^[\]\n]+\]\]$/, (state, match, start, end) => {
      const before = state.doc.textBetween(Math.max(0, start - 1), start);
      if (before === "!") return null;
      return state.tr.replaceWith(
        start,
        end,
        wikilinkSchema.type(ctx).create({}, state.schema.text(match[0])),
      );
    }),
);

const WHOLE_WIKILINK = new RegExp(`(^|[^!])(${WIKILINK_SOURCE})`, "g");

/** `[[...]]` put in as text in one go - a completion taken - made the
 *  wikilinks typing their last "]" makes, so a save keeps their brackets. */
export function wikilinksIn(tr: Transaction, from: number, to: number): void {
  const type = tr.doc.type.schema.nodes.wikilink;
  if (!type) return;
  const text = tr.doc.textBetween(from, to, "\n", "\n");
  const found: [number, number, string][] = [];
  for (const m of text.matchAll(WHOLE_WIKILINK)) {
    const start = from + m.index + m[1].length;
    found.push([start, start + m[2].length, m[2]]);
  }
  // From the end, so the earlier positions still hold.
  for (const [start, end, source] of found.reverse())
    tr.replaceWith(
      start,
      end,
      type.create({}, tr.doc.type.schema.text(source)),
    );
}
