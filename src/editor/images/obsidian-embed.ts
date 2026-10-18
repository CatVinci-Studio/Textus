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
 * Obsidian's embeds, `![[file]]` (issue #135). An Obsidian vault links its
 * pictures this way, and Textus showed them as text. The embed is kept as
 * written - its whole source is the node's text, like raw HTML
 * (html/raw-html-schema.ts) - so saving writes it back unchanged;
 * obsidian-embed-preview.ts shows an image embed as the picture while the
 * caret is elsewhere. Any other embed (a note, a heading) stays text.
 *
 * HTML and PDF exports are copies of the editor's page, so they carry the
 * picture (its src: obsidian-embed-preview.ts's exportSrc). Exports from the
 * Markdown source -
 * Word and the other Pandoc formats - keep the embed as text: Pandoc can't
 * read it, and rewriting it to `![](path)` would change what was written.
 */

declare module "micromark-util-types" {
  interface TokenTypeMap {
    obsidianEmbed: "obsidianEmbed";
  }
}

/** An embed as mdast: `value` is its source, `![[` to `]]`. */
export interface ObsidianEmbed extends Literal {
  type: "obsidianEmbed";
}

declare module "mdast" {
  interface PhrasingContentMap {
    obsidianEmbed: ObsidianEmbed;
  }
  interface RootContentMap {
    obsidianEmbed: ObsidianEmbed;
  }
}

/** File types an embed shows as a picture - IMAGE_EXTENSIONS in
 *  src-tauri/src/commands/vault.rs. */
export const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "avif",
  "bmp",
] as const;

function isImageFile(file: string): boolean {
  const ext = /\.([^./]+)$/.exec(file)?.[1].toLowerCase();
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext ?? "");
}

export interface EmbedTarget {
  /** The file as written: a name or a path from the vault root. */
  path: string;
  alt: string;
  /** Obsidian's size suffix, `|300` or `|300x200`, in CSS pixels. */
  width: number | null;
  height: number | null;
  isImage: boolean;
}

/** What an embed's source (`![[path|alt|300x200]]`) asks for; null when it
 *  isn't one. */
export function parseEmbed(source: string): EmbedTarget | null {
  const match = /^!\[\[([^[\]\n]+)\]\]$/.exec(source);
  if (!match) return null;
  const [path, ...options] = match[1].split("|");
  let width: number | null = null;
  let height: number | null = null;
  const alt: string[] = [];
  for (const option of options) {
    const size = /^\s*(\d+)(?:x(\d+))?\s*$/.exec(option);
    if (size && width === null) {
      width = Number(size[1]);
      height = size[2] ? Number(size[2]) : null;
    } else alt.push(option.trim());
  }
  const file = path.trim();
  // `![[Note#Heading]]` and `![[pic.png#^block]]` point inside a note.
  return {
    path: file,
    alt: alt.join("|"),
    width,
    height,
    isImage: !file.includes("#") && isImageFile(file),
  };
}

const BANG = 33; // "!"
const OPEN = 91; // "["
const CLOSE = 93; // "]"

/** micromark: `![[`, then anything but brackets and line endings, then
 *  `]]` - one token, so nothing inside (a "_" in a file name) is read as
 *  emphasis. Tried before CommonMark's image start, which would otherwise
 *  take the `![`. */
function embedSyntax(): Extension {
  return {
    text: { [BANG]: { name: "obsidianEmbed", tokenize } },
  };

  function tokenize(
    this: TokenizeContext,
    effects: Effects,
    ok: State,
    nok: State,
  ): State {
    let brackets = 0;
    let empty = true;
    return start;

    function start(code: Code): State | undefined {
      effects.enter("obsidianEmbed");
      effects.consume(code);
      return open;
    }
    function open(code: Code): State | undefined {
      if (code !== OPEN) return nok(code);
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
      effects.exit("obsidianEmbed");
      return ok;
    }
  }
}

const enterEmbed: FromMarkdownHandle = function (token) {
  this.enter(
    { type: "obsidianEmbed", value: this.sliceSerialize(token) },
    token,
  );
};

const exitEmbed: FromMarkdownHandle = function (token) {
  this.exit(token);
};

const embedFromMarkdown: FromMarkdownExtension = {
  enter: { obsidianEmbed: enterEmbed },
  exit: { obsidianEmbed: exitEmbed },
};

const embedToMarkdown: ToMarkdownExtension = {
  // Written as it was read: escaping its brackets would turn it to text.
  handlers: { obsidianEmbed: (node: ObsidianEmbed) => node.value },
};

const remarkObsidianEmbed: RemarkPluginRaw<unknown> = function (this: {
  data: () => Record<string, unknown[]>;
}) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(embedSyntax());
  (data.fromMarkdownExtensions ??= []).push(embedFromMarkdown);
  (data.toMarkdownExtensions ??= []).push(embedToMarkdown);
} as unknown as RemarkPluginRaw<unknown>;

export const remarkObsidianEmbedPlugin = $remark(
  "remark-obsidian-embed",
  () => remarkObsidianEmbed,
);

export const obsidianEmbedSchema = $nodeSchema("obsidian_embed", () => ({
  content: "text*",
  group: "inline",
  inline: true,
  marks: "",
  // Source, like raw HTML: "*" typed in a file name is not bold.
  code: true,
  attrs: {},
  parseDOM: [
    { tag: 'span[data-type="obsidian_embed"]', preserveWhitespace: "full" },
  ],
  toDOM: () => [
    "span",
    { "data-type": "obsidian_embed", class: "obsidian-embed-source" },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === "obsidianEmbed",
    runner: (state, node, type) => {
      state.openNode(type);
      state.addText(node.value as string);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "obsidian_embed",
    runner: (state, node) => {
      state.addNode("obsidianEmbed", undefined, node.textContent);
    },
  },
}));

/** `![[...]]` typed or pasted as text becomes an embed once it closes. */
export const obsidianEmbedInputRule = $inputRule(
  (ctx) =>
    new InputRule(/!\[\[[^[\]\n]+\]\]$/, (state, match, start, end) =>
      state.tr.replaceWith(
        start,
        end,
        obsidianEmbedSchema.type(ctx).create({}, state.schema.text(match[0])),
      ),
    ),
);
