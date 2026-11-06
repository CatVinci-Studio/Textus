import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import { applyReveal, revealAll, type Reveal } from "../reveal-state";
import type { RevealState, Touches } from "../reveal-state";
import {
  MARK_COLOURS,
  OBJECT,
  findInlineSyntax,
  markColourAt,
} from "./inline-syntax";

/** The classes a `%%comment%%` is drawn with, shown or folded away; an
 *  export leaves out whatever carries one. */
const COMMENT_HIDDEN = "md-comment-hidden";
export const COMMENT_SELECTOR = `.md-comment, .md-comment-block, .${COMMENT_HIDDEN}`;

const inlineSyntaxKey = new PluginKey<RevealState>("inline-syntax");

/** A textblock's words as one string, with the document position of each
 *  character; code and atoms are one OBJECT each. */
function flatten(block: ProseNode, start: number) {
  let text = "";
  const at: number[] = [];
  const marks: { pos: number; node: ProseNode }[] = [];
  block.descendants((child, offset) => {
    const pos = start + offset;
    if (child.isText) {
      for (let i = 0; i < child.text!.length; i++) at.push(pos + i);
      text += child.text;
      return false;
    }
    if (child.isLeaf || child.type.spec.code) {
      at.push(pos);
      text += OBJECT;
      return false;
    }
    if (child.type.name === "md_span" && child.attrs.delim === "=")
      marks.push({ pos, node: child });
    return true;
  });
  return { text, at, marks };
}

const hide = (from: number, to: number) =>
  Decoration.inline(from, to, { class: "md-syntax-hidden" });

function decorateBlock(
  block: ProseNode,
  pos: number,
  touches: Touches,
): Decoration[] {
  const out: Decoration[] = [];
  const { text, at, marks } = flatten(block, pos + 1);
  const docRange = (from: number, to: number) =>
    [at[from], at[to - 1] + 1] as const;
  for (const found of findInlineSyntax(text)) {
    const [from, to] = docRange(found.from, found.to);
    const near = touches(from, to);
    if (found.kind === "comment") {
      if (near) out.push(Decoration.inline(from, to, { class: "md-comment" }));
      else if (text.trim() === text.slice(found.from, found.to))
        // A line that is all comment folds away, not leaving a gap.
        out.push(
          Decoration.node(pos, pos + block.nodeSize, {
            class: "md-comment-block",
          }),
        );
      else
        out.push(
          Decoration.inline(from, to, {
            class: `md-syntax-hidden ${COMMENT_HIDDEN}`,
          }),
        );
    } else if (found.kind === "blockId") {
      if (!near)
        out.push(Decoration.inline(from, to, { class: "md-block-id" }));
    } else if (!near) {
      const [innerFrom, innerTo] = docRange(...found.inner);
      out.push(
        hide(from, innerFrom),
        Decoration.inline(innerFrom, innerTo, { class: "md-inline-footnote" }),
        hide(innerTo, to),
      );
    }
  }
  for (const { pos: markPos, node } of marks) {
    const first = node.firstChild;
    const emoji = first?.isText ? markColourAt(first.text!) : null;
    if (!emoji) continue;
    const end = markPos + node.nodeSize;
    out.push(
      Decoration.node(markPos, end, {
        class: `md-mark-${MARK_COLOURS[emoji]}`,
      }),
    );
    if (!touches(markPos, end))
      out.push(hide(markPos + 1, markPos + 1 + emoji.length));
  }
  return out;
}

const reveal: Reveal = {
  match: (node) => node.isTextblock && !node.type.spec.code,
  decorate: decorateBlock,
};

/** `%%comments%%` hidden, `^block-ids` dimmed, `^[inline footnotes]` and
 *  `==🔴coloured==` highlights drawn - each shown as written while the
 *  caret is on it. The file is never changed. */
export const inlineSyntaxPlugin = $prose(
  () =>
    new Plugin<RevealState>({
      key: inlineSyntaxKey,
      state: {
        init: (_config, state) => revealAll(state, reveal),
        apply: (tr, prev, oldState, newState) =>
          applyReveal(tr, prev, oldState, newState, reveal),
      },
      props: {
        decorations: (state) => inlineSyntaxKey.getState(state)?.set,
      },
    }),
);
