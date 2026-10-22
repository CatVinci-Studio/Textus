import { $inputRule, $nodeSchema, $remark } from "@milkdown/kit/utils";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import type { RemarkPluginRaw } from "@milkdown/kit/transformer";
import type {
  Code,
  Effects,
  Extension,
  State,
  TokenizeContext,
} from "micromark-util-types";
import type {
  Extension as FromMarkdownExtension,
  Handle as FromMarkdownHandle,
} from "mdast-util-from-markdown";
import type { Options as ToMarkdownExtension } from "mdast-util-to-markdown";
import type { Literal } from "mdast";

/**
 * Obsidian's wikilinks: `[[Note]]`, `[[Note|shown text]]`,
 * `[[Note#Heading]]`. Textus saved them as `\[\[Note]]`, which Obsidian no
 * longer reads as a link. Kept as written, like an embed
 * (images/obsidian-embed.ts): the whole source is the node's text, shown
 * in the link colour, and written back unchanged. Ctrl/Cmd+click opens the
 * note (link-click-plugin.ts), found in the document's vault the way
 * Obsidian finds it (commands/vault.rs).
 */

declare module "micromark-util-types" {
  interface TokenTypeMap {
    wikilink: "wikilink";
  }
}

/** A wikilink as mdast: `value` is its source, `[[` to `]]`. */
export interface Wikilink extends Literal {
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

const WIKILINK_SOURCE = /^\[\[([^[\]\n]+)\]\]$/;

export interface WikilinkTarget {
  /** The note as written, without `#heading` and `|text`; empty for a
   *  heading of this document (`[[#Heading]]`). */
  note: string;
  heading: string | null;
}

/** What a wikilink's source (`[[Note#Heading|text]]`) points at; null
 *  when it isn't one. */
export function parseWikilink(source: string): WikilinkTarget | null {
  const match = WIKILINK_SOURCE.exec(source);
  if (!match) return null;
  const [target] = match[1].split("|");
  const hash = target.indexOf("#");
  const note = (hash < 0 ? target : target.slice(0, hash)).trim();
  const heading = hash < 0 ? null : target.slice(hash + 1).trim() || null;
  if (!note && !heading) return null;
  return { note, heading };
}

const OPEN = 91; // "["
const CLOSE = 93; // "]"
const PAREN = 40; // "("

/** micromark: `[[`, then anything but brackets and line endings, then
 *  `]]` - one token, so nothing inside (a "_" in a name) is read as
 *  emphasis. Tried before CommonMark's link start; `[[x]](url)`, a link
 *  whose text has brackets, is left to it. */
function wikilinkSyntax(): Extension {
  return {
    text: { [OPEN]: { name: "wikilink", tokenize } },
  };

  function tokenize(
    this: TokenizeContext,
    effects: Effects,
    ok: State,
    nok: State,
  ): State {
    let brackets = 0;
    let empty = true;
    return open;

    function open(code: Code): State | undefined {
      if (code !== OPEN) return nok(code);
      if (brackets === 0) effects.enter("wikilink");
      effects.consume(code);
      return ++brackets === 2 ? inside : open;
    }
    function inside(code: Code): State | undefined {
      // Negative codes are line endings and tabs.
      if (code === null || code < 0 || code === OPEN) return nok(code);
      if (code === CLOSE && empty) return nok(code);
      effects.consume(code);
      if (code === CLOSE) return closeSecond;
      empty = false;
      return inside;
    }
    function closeSecond(code: Code): State | undefined {
      if (code !== CLOSE) return nok(code);
      effects.consume(code);
      return after;
    }
    function after(code: Code): State | undefined {
      if (code === PAREN) return nok(code);
      effects.exit("wikilink");
      return ok(code);
    }
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
  (data.micromarkExtensions ??= []).push(wikilinkSyntax());
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

/** `[[...]]` typed as text becomes a wikilink once it closes - not the end
 *  of an embed, `![[...]]`, which has its own rule. */
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
