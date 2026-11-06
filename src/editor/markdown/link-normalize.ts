import { parserCtx } from "@milkdown/kit/core";
import { isHistoryTransaction } from "@milkdown/kit/prose/history";
import { Fragment } from "@milkdown/kit/prose/model";
import type { Node as ProseNode, Schema } from "@milkdown/kit/prose/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { changedRanges } from "../changed-ranges";
import { cursorTouches } from "../marks/enclosure";
import { definedLabels, definitionsIn } from "./link-reveal";
import { LINK } from "./link-source";
import {
  isDanglingReference,
  linkAt,
  parseLink,
  splitAroundLink,
} from "./link-syntax";

/**
 * Keeps a link node one link as its source is typed in: text typed before
 * or after it moves out of it at once, and a source edited into something
 * else reads as what it now is once the caret leaves it. Only typing counts;
 * undo and redo restore links as they were.
 */

const key = new PluginKey<number[]>("link-normalize");

/** What `source` reads as on its own: the inline content of the one
 *  paragraph it makes, or else itself as text. `definitions` are the
 *  document's `[ref]: url` lines, for a reference link. */
export function parseLinkSource(
  parse: (markdown: string) => ProseNode,
  schema: Schema,
  source: string,
  definitions: () => string[],
): Fragment {
  const asText = Fragment.from(source ? schema.text(source) : []);
  const core = source.trim();
  if (!core) return asText;
  // Spaces at its ends are text: at a line's start they would make code of it.
  const lead = source.slice(0, source.indexOf(core));
  const trail = source.slice(lead.length + core.length);
  const defs = core.includes("](") || !core.includes("]") ? [] : definitions();
  let doc: ProseNode;
  try {
    doc = parse([core, ...defs].join("\n\n"));
  } catch {
    return asText;
  }
  const first = doc.firstChild;
  if (first?.type.name !== "paragraph") return asText;
  let definition = false;
  first.forEach((child) => {
    definition ||= child.type.name === "link_definition";
  });
  if (definition) return asText;
  const nodes: ProseNode[] = [];
  if (lead) nodes.push(schema.text(lead));
  first.forEach((child) => nodes.push(child));
  if (trail) nodes.push(schema.text(trail));
  return Fragment.fromArray(nodes);
}

/** A `[text]` alone, which is a link only where its definition is. */
const isShortcut = (text: string) => {
  const parts = linkAt(text);
  return parts?.kind === "reference" && parts.end === parts.label[1] + 1;
};

/** The link at `pos` with what was typed at its ends moved out, when the
 *  caret is in that typing. */
function splitEdges(tr: Transaction, pos: number, node: ProseNode): boolean {
  const split = splitAroundLink(node.textContent);
  if (
    !split ||
    (!split.lead && !split.trail) ||
    isShortcut(split.link) ||
    // "!" before "[" makes an image of it, read once the caret leaves.
    (split.lead.endsWith("!") && split.link.startsWith("["))
  )
    return false;
  const { selection } = tr;
  const offset = selection.empty ? selection.from - pos - 1 : -1;
  const linkEnd = split.lead.length + split.link.length;
  const inLead = split.lead && offset >= 0 && offset <= split.lead.length;
  const inTrail = split.trail && offset >= linkEnd;
  if (!inLead && !inTrail) return false;
  const { schema } = tr.doc.type;
  const link = node.type.create(null, schema.text(split.link));
  tr.replaceWith(
    pos,
    pos + node.nodeSize,
    [
      split.lead && schema.text(split.lead),
      link,
      split.trail && schema.text(split.trail),
    ].filter((part): part is ProseNode => !!part),
  );
  const caret = inLead
    ? pos + offset
    : pos + split.lead.length + link.nodeSize + (offset - linkEnd);
  tr.setSelection(TextSelection.create(tr.doc, caret));
  return true;
}

function normalize(
  state: EditorState,
  positions: number[],
  reparse: (source: string, doc: ProseNode) => Fragment,
): Transaction | null {
  const tr = state.tr;
  let labels: Set<string> | null = null;
  // A reference without its definition reopens as text, so it reads as one.
  const isLinkText = (text: string) =>
    !!parseLink(text) &&
    !isDanglingReference(text, (labels ??= definedLabels(state.doc)));
  for (const pos of [...positions].sort((a, b) => b - a)) {
    const node = tr.doc.nodeAt(pos);
    if (node?.type.name !== LINK) continue;
    const text = node.textContent;
    const end = pos + node.nodeSize;
    if (!text) tr.delete(pos, end);
    else if (isLinkText(text)) continue;
    else if (splitEdges(tr, pos, node)) continue;
    else if (!cursorTouches(tr.selection, pos, end))
      tr.replaceWith(pos, end, reparse(text, tr.doc));
  }
  return tr.docChanged ? tr.setMeta(key, true) : null;
}

/** The links an edit typed into, carried through `tr`; one that was a
 *  whole link with the caret away is done. */
function tracked(
  tr: Transaction,
  prev: number[],
  oldState: EditorState,
): number[] {
  if (isHistoryTransaction(tr)) return [];
  const found = new Set<number>();
  for (const pos of prev) {
    const before = oldState.doc.nodeAt(pos);
    const done =
      before?.type.name === LINK &&
      !!parseLink(before.textContent) &&
      !cursorTouches(oldState.selection, pos, pos + before.nodeSize);
    const mapped = tr.mapping.map(pos, 1);
    if (!done && tr.doc.nodeAt(mapped)?.type.name === LINK) found.add(mapped);
  }
  if (tr.docChanged && !tr.getMeta(key))
    for (const [from, to] of changedRanges(tr))
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name === LINK) found.add(pos);
        return node.isBlock || node.type.name === LINK;
      });
  return [...found];
}

export const linkNormalizePlugin = $prose((ctx) => {
  const reparse = (source: string, doc: ProseNode) =>
    parseLinkSource(ctx.get(parserCtx), doc.type.schema, source, () =>
      definitionsIn(doc),
    );
  return new Plugin<number[]>({
    key,
    state: {
      init: () => [],
      apply: (tr, prev, oldState) => tracked(tr, prev, oldState),
    },
    appendTransaction(transactions, _old, state) {
      const positions = key.getState(state) ?? [];
      if (
        positions.length === 0 ||
        transactions.some(
          (tr) => isHistoryTransaction(tr) || tr.getMeta("composition"),
        )
      )
        return null;
      return normalize(state, positions, reparse);
    },
  });
});
