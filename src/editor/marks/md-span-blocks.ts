import { canJoin, findWrapping } from "@milkdown/kit/prose/transform";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { literalTextAfter, literalTextBefore } from "./enclosure";
import { caretAt } from "../live-selection";
import {
  SPECS,
  closeOpenRun,
  closeUnderscoreRun,
  pairsIn,
  runsHoldAtoms,
} from "./md-span-runs";

/** Delimiters typed at a line's start that make a block instead of a span:
 *  a code fence, a rule, a bullet item. */

/**
 * A paragraph's code-fence language ("" for none), or null if it isn't a
 * "```lang" line. Three typed backticks leave a code span holding one
 * backtick, so that shape counts, as do a literal "```lang" or "~~~lang".
 */
export function codeFenceLanguage(paragraph: ProseNode): string | null {
  if (paragraph.childCount === 0 || paragraph.childCount > 2) return null;
  const first = paragraph.child(0);
  let rest: string;
  if (first.type.name === "md_code_span" && first.textContent === "`") {
    if (paragraph.childCount === 2) {
      const second = paragraph.child(1);
      if (!second.isText) return null;
      rest = second.text ?? "";
    } else {
      rest = "";
    }
  } else if (paragraph.childCount === 1 && first.isText) {
    const match = /^(?:```|~~~)(.*)$/.exec(first.text ?? "");
    if (!match) return null;
    rest = match[1];
  } else {
    return null;
  }
  const language = rest.trim();
  return /\s/.test(language) ? null : language;
}

/**
 * An empty "*" shell that is all its paragraph holds, as "*" or "***" at a
 * line's start leaves: a list marker or a rule there. Its rung and the
 * paragraph's position, or null.
 */
export function lineStartStars(
  $pos: ReturnType<ProseNode["resolve"]>,
): { rung: number; paragraphPos: number } | null {
  const shell = $pos.parent;
  if (
    shell.type.name !== "md_span" ||
    shell.attrs.delim !== "*" ||
    shell.content.size !== 0 ||
    $pos.depth < 2
  )
    return null;
  const paragraph = $pos.node($pos.depth - 1);
  if (paragraph.type.name !== "paragraph" || paragraph.childCount !== 1)
    return null;
  return {
    rung: (shell.attrs.rung as number) ?? 1,
    paragraphPos: $pos.before($pos.depth - 1),
  };
}

/** The paragraph at `paragraphPos` as a horizontal rule, the caret on a
 *  new line below it. */
export function paragraphToRule(
  state: EditorState,
  paragraphPos: number,
): Transaction | null {
  const { hr, paragraph } = state.schema.nodes;
  if (!hr || !paragraph) return null;
  const size = state.doc.nodeAt(paragraphPos)!.nodeSize;
  const tr = state.tr.replaceWith(paragraphPos, paragraphPos + size, [
    hr.create(),
    paragraph.create(),
  ]);
  return caretAt(tr, paragraphPos + 2);
}

/** The paragraph at `paragraphPos`, emptied, as the first item of a bullet
 *  list, joined to one right above as "- " does. */
export function paragraphToBulletItem(
  state: EditorState,
  paragraphPos: number,
): Transaction | null {
  const list = state.schema.nodes.bullet_list;
  const paragraph = state.doc.nodeAt(paragraphPos)!;
  const tr = state.tr.delete(
    paragraphPos + 1,
    paragraphPos + paragraph.nodeSize - 1,
  );
  const $start = tr.doc.resolve(paragraphPos + 1);
  const range = $start.blockRange();
  const wrapping = list && range && findWrapping(range, list);
  if (!range || !wrapping) return null;
  tr.wrap(range, wrapping);
  const before = tr.doc.resolve(paragraphPos).nodeBefore;
  if (before?.type === list && canJoin(tr.doc, paragraphPos))
    tr.join(paragraphPos);
  return tr.scrollIntoView();
}

/**
 * The IME counterpart of run closing: Chinese-mode Windows IMEs (Microsoft
 * Pinyin, Sogou) deliver even "*" through a composition. Once committed, a
 * complete closing run before the caret that pairs with an opening run is
 * converted; nothing opens a shell after the fact. Only when `committed`
 * ends in the delimiter. Returns whether it converted anything.
 */
export function convertRunClosedBeforeCaret(
  view: EditorView,
  committed: string,
): boolean {
  const { state } = view;
  const sel = state.selection;
  if (!sel.empty) return false;
  const $pos = sel.$from;
  if (committed.endsWith("_")) {
    const { text, from } = literalTextBefore($pos, true);
    return (
      text.endsWith("_") &&
      closeUnderscoreRun(view, text.slice(0, -1), from, sel.from)
    );
  }
  const spec = SPECS.find((s) => committed.endsWith(s.char));
  if (!spec || !pairsIn($pos.parent, spec)) return false;
  const { text: textBefore, from: runStart } = literalTextBefore(
    $pos,
    runsHoldAtoms(spec),
  );
  if (!textBefore.endsWith(spec.char)) return false;
  // The caret sits inside a longer delimiter run - not a finished closer.
  if (literalTextAfter($pos).text.startsWith(spec.char)) return false;
  // findRunOpen expects the last closing character as "the one being typed".
  return closeOpenRun(view, spec, textBefore.slice(0, -1), runStart, sel.from);
}
