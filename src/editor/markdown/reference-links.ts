import { $nodeSchema, $remark } from "@milkdown/kit/utils";
import type { RemarkPluginRaw } from "@milkdown/kit/transformer";
import type { Literal } from "mdast";

/**
 * Reference links, `[text][ref]` with a `[ref]: url` definition elsewhere.
 * Milkdown's remarkInlineLinkPlugin (left out, reduced-presets.ts) turned
 * each into an inline link and deleted the definitions, so a file written
 * with references lost them on its first save.
 *
 * Here a reference is read as an ordinary link (or image) to the URL its
 * definition gives - it shows and opens like one - remembering how it was
 * written, and is written back as that reference while its URL and title
 * are the definition's. A definition is kept as its source text, shown as
 * written, like raw HTML (html/raw-html-schema.ts), and written back as it
 * is.
 */

declare module "mdast" {
  interface PhrasingContentMap {
    linkDefinition: LinkDefinition;
  }
  interface RootContentMap {
    linkDefinition: LinkDefinition;
  }
}

/** A definition as mdast: `value` is its source, `[ref]: url "title"`. */
export interface LinkDefinition extends Literal {
  type: "linkDefinition";
}

/** How a reference was written, kept on the link mark or image node (as
 *  JSON, in a `reference` attr) to write it back. */
export interface LinkReference {
  /** `[text][ref]`, `[ref][]` or `[ref]`. */
  type: "full" | "collapsed" | "shortcut";
  /** The label as written. */
  label: string;
  /** What the definition said: written back as a reference only while
   *  the link still says it. */
  url: string;
  title: string;
}

/** A link's or image's `reference` attr, read back; null for one that
 *  wasn't written as a reference. */
export function readReference(attr: unknown): LinkReference | null {
  if (typeof attr !== "string" || !attr) return null;
  try {
    const parsed = JSON.parse(attr) as LinkReference;
    return typeof parsed.label === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** The mdast node a link or image written as `reference` is serialized
 *  as, when its URL and title are still the definition's. */
export function referenceFor(
  attr: unknown,
  url: string,
  title: string | null | undefined,
): { identifier: string; label: string; referenceType: string } | null {
  const reference = readReference(attr);
  if (!reference || reference.url !== url) return null;
  if ((reference.title || "") !== (title || "")) return null;
  return {
    identifier: reference.label.toLowerCase(),
    label: reference.label,
    referenceType: reference.type,
  };
}

interface DefinitionNode {
  type: "definition";
  identifier: string;
  label?: string | null;
  url: string;
  title?: string | null;
  position?: {
    start: { line: number; offset?: number };
    end: { line: number; offset?: number };
  };
}

/** A definition's source: the file's own text when it is on one line;
 *  otherwise (one inside a quote carries its `>` markers on every line)
 *  written out again. */
function definitionSource(node: DefinitionNode, file: string): string {
  const { position } = node;
  const start = position?.start.offset;
  const end = position?.end.offset;
  if (
    position &&
    start !== undefined &&
    end !== undefined &&
    position.start.line === position.end.line
  )
    return file.slice(start, end);
  const url = /[\s<>]/.test(node.url) || !node.url ? `<${node.url}>` : node.url;
  const title = node.title ? ` "${node.title.replace(/"/g, '\\"')}"` : "";
  return `[${node.label ?? node.identifier}]: ${url}${title}`;
}

/** An mdast node, loosely: the pass below changes nodes' types. */
interface AnyNode {
  type: string;
  children?: AnyNode[];
  [key: string]: unknown;
}

const remarkReferenceLinks: RemarkPluginRaw<unknown> = () => (tree, file) => {
  const source = String(file.value ?? "");
  const root = tree as unknown as AnyNode;
  const definitions = new Map<string, DefinitionNode>();
  const collect = (node: AnyNode) => {
    if (node.type === "definition") {
      const definition = node as unknown as DefinitionNode;
      // The first definition of a label is the one that counts.
      if (!definitions.has(definition.identifier))
        definitions.set(definition.identifier, definition);
      return;
    }
    node.children?.forEach(collect);
  };
  collect(root);
  const convert = (node: AnyNode) => {
    node.children?.forEach((child, index, children) => {
      if (child.type === "definition") {
        // In the paragraph a definition stands for, as its source text.
        const value = definitionSource(
          child as unknown as DefinitionNode,
          source,
        );
        children[index] = {
          type: "paragraph",
          children: [{ type: "linkDefinition", value }],
          position: child.position,
        };
        return;
      }
      if (child.type === "linkReference" || child.type === "imageReference") {
        const definition = definitions.get(child.identifier as string);
        if (definition) {
          const reference: LinkReference = {
            type: child.referenceType as LinkReference["type"],
            label: (child.label as string | undefined) ?? definition.identifier,
            url: definition.url,
            title: definition.title ?? "",
          };
          child.type = child.type === "linkReference" ? "link" : "image";
          child.url = definition.url;
          child.title = definition.title ?? null;
          child.data = { ...(child.data as object | undefined), reference };
          delete child.identifier;
          delete child.label;
          delete child.referenceType;
        }
      }
      convert(child);
    });
  };
  convert(root);
};

export const remarkReferenceLinksPlugin = $remark(
  "remark-reference-links",
  () => remarkReferenceLinks,
);

export const linkDefinitionSchema = $nodeSchema("link_definition", () => ({
  content: "text*",
  group: "inline",
  inline: true,
  marks: "",
  // Source, like raw HTML: a "_" in a URL is not emphasis.
  code: true,
  attrs: {},
  parseDOM: [
    { tag: 'span[data-type="link_definition"]', preserveWhitespace: "full" },
  ],
  toDOM: () => [
    "span",
    { "data-type": "link_definition", class: "link-definition-source" },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === "linkDefinition",
    runner: (state, node, type) => {
      state.openNode(type);
      if (node.value) state.addText(node.value as string);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "link_definition",
    // Written as it reads, as raw HTML is: `html` is the mdast node whose
    // value goes out verbatim.
    runner: (state, node) => {
      state.addNode("html", undefined, node.textContent);
    },
  },
}));
