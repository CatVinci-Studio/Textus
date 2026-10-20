import { $remark } from "@milkdown/kit/utils";
import type { RemarkPluginRaw } from "@milkdown/kit/transformer";

/**
 * A link remembers the Markdown it was written as, the way an image read
 * from an `<img>` tag keeps the tag (images/image-html.ts). The caret on a
 * link shows that source to edit (link-reveal.ts): a bare
 * `https://example.com` shows bare and `[a](<b c> 'd')` as it was typed,
 * not as remark would write them. A save writes it back too, while the
 * link still says what it said (markdown-output.ts).
 *
 * Kept on the link mark as JSON, in a `source` attr: the text, and what the
 * link said when it was read - its URL, title and a key of its content -
 * so a link changed some other way (its URL edited, a word of it bold) is
 * written by the serializer again rather than as the old text.
 */
export interface LinkSource {
  source: string;
  url: string;
  title: string;
  /** phrasingKey of the link's content. */
  key: string;
}

interface Phrasing {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  children?: Phrasing[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/** What a link's mdast content says, as one string: its text, and the
 *  kind and target of what isn't text. The same whether the content was
 *  read from a file or written from the editor, which splits text into
 *  pieces differently. */
export function phrasingKey(nodes: readonly Phrasing[] | undefined): string {
  return (nodes ?? [])
    .map((node) =>
      node.type === "text"
        ? (node.value ?? "")
        : `\u0000${node.type}:${node.value ?? ""}|${node.url ?? ""}|${node.alt ?? ""}{${phrasingKey(node.children)}}`,
    )
    .join("");
}

/** A link mark's `source` attr, read back; null for none. */
export function readLinkSource(attr: unknown): LinkSource | null {
  if (typeof attr !== "string" || !attr) return null;
  try {
    const parsed = JSON.parse(attr) as LinkSource;
    return typeof parsed.source === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** Each link's source text, onto its mdast node as `data.source` - after
 *  reference-links.ts has given a reference its URL. */
const remarkLinkSource: RemarkPluginRaw<unknown> = () => (tree, file) => {
  const text = String((file as { value?: unknown }).value ?? "");
  const walk = (node: Phrasing) => {
    if (node.type === "link") {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (start !== undefined && end !== undefined && end > start) {
        const source: LinkSource = {
          source: text.slice(start, end),
          url: node.url ?? "",
          title: (node.title as string | null | undefined) ?? "",
          key: phrasingKey(node.children),
        };
        node.data = { ...node.data, source: JSON.stringify(source) };
      }
      return;
    }
    node.children?.forEach(walk);
  };
  walk(tree as unknown as Phrasing);
};

export const remarkLinkSourcePlugin = $remark(
  "remark-link-source",
  () => remarkLinkSource,
);
