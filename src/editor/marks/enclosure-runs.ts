import type { Selection } from "@milkdown/kit/prose/state";
import type { Node as ProseNode, ResolvedPos } from "@milkdown/kit/prose/model";
import { spanDelimText } from "./md-span-schema";

/**
 * What an enclosure is - a node shown with its delimiters, such as
 * `**bold**` or `` `code` `` - and the literal text runs beside the caret
 * a typed delimiter may open or close (enclosure.ts). Pure functions of
 * the document.
 */

export const ENCLOSURE_NODES = new Set([
  "md_span",
  "md_code_span",
  "math_inline",
  "math_block",
]);

export function isEnclosureName(name: string): boolean {
  return ENCLOSURE_NODES.has(name);
}

export function isEnclosure(node: ProseNode): boolean {
  return ENCLOSURE_NODES.has(node.type.name);
}

/** The literal delimiters an enclosure node's syntax is rendered as,
 *  opening and closing: the same but for LaTeX's `\(...\)` and `\[...\]`
 *  (math-schema.ts). */
export function enclosureDelims(node: ProseNode): {
  open: string;
  close: string;
} {
  let open = spanDelimText(node);
  if (node.type.name === "math_inline")
    open = (node.attrs.delimiter as string | undefined) ?? "$";
  if (node.type.name === "math_block") open = "$$";
  const close = open === "\\(" ? "\\)" : open === "\\[" ? "\\]" : open;
  return { open, close };
}

/**
 * Whether the selection is inside OR immediately adjacent to the node's
 * outer bounds. Adjacency counts as "touching" so the delimiters stay
 * revealed while the cursor sits just outside them - the intermediate phase
 * that makes them addressable (and deletable) at all. Both the reveal
 * decorations here and math-preview's "render KaTeX instead" check must use
 * this same predicate or the two representations would overlap.
 */
export function cursorTouches(
  selection: Selection,
  from: number,
  to: number,
): boolean {
  return selection.from <= to && selection.to >= from;
}

/**
 * Inline nodes a bold, italic, strikethrough or highlight run can hold
 * whole, as `**a `b` c**` holds its code. Left out of the run, the literal
 * "**a " before a code span never paired with a "**" typed after it: bold
 * whose closer was deleted and retyped, or typed with Settings > Close
 * formatting marks automatically off, stayed text with asterisks in it.
 */
export const RUN_ATOMS = new Set(["md_code_span", "math_inline"]);

/** A RUN_ATOMS node in a run: one character per position it takes up, so
 *  offsets into the text stay offsets into the document. Neither a
 *  delimiter nor a space, so it can't open, close or edge a run. */
export const ATOM_CHAR = "￼";

export function runText(node: ProseNode, withAtoms: boolean): string | null {
  if (node.isText) return node.text ?? "";
  if (withAtoms && RUN_ATOMS.has(node.type.name))
    return ATOM_CHAR.repeat(node.nodeSize);
  return null;
}

/**
 * The contiguous run of plain text directly before $pos within its parent,
 * stopping at any non-text inline node - but code and maths, `withAtoms`
 * (see RUN_ATOMS). Backward-pairing must only ever look at this run:
 * parent.textContent-based slicing counts characters while document
 * positions count node boundaries too, so the two drift apart as soon as
 * the paragraph contains any enclosure node - and pairing across an
 * existing span would be wrong anyway.
 */
export function literalTextBefore(
  $pos: ResolvedPos,
  withAtoms = false,
): {
  text: string;
  from: number;
} {
  const parent = $pos.parent;
  let offset = $pos.parentOffset;
  let text = "";
  while (offset > 0) {
    const child = parent.childBefore(offset);
    const childText = child.node && runText(child.node, withAtoms);
    if (childText == null) break;
    text = childText.slice(0, offset - child.offset) + text;
    offset = child.offset;
  }
  return { text, from: $pos.start() + offset };
}

/** Mirror of literalTextBefore: the contiguous run of plain text directly
 *  after $pos, stopping at any non-text inline node. */
export function literalTextAfter(
  $pos: ResolvedPos,
  withAtoms = false,
): { text: string } {
  const parent = $pos.parent;
  let offset = $pos.parentOffset;
  let text = "";
  while (offset < parent.content.size) {
    const child = parent.childAfter(offset);
    const childText = child.node && runText(child.node, withAtoms);
    if (childText == null) break;
    text += childText.slice(offset - child.offset);
    offset = child.offset + child.node!.nodeSize;
  }
  return { text };
}

/** The value a delimiter pair may enclose: non-empty, no whitespace at its
 *  edges, no delimiter characters inside. Shared by every run-pairing rule
 *  (findRunOpen / hasPendingRunOpen / findRunClose) so backward and forward
 *  pairing can never disagree on what makes a valid enclosure. */
export function isValidRunValue(value: string, char: string): boolean {
  return value.length > 0 && !/^\s|\s$/.test(value) && !value.includes(char);
}

/**
 * Looks for an unclosed opening run of exactly `rung` delimiter characters
 * in `textBefore` that the character being typed right now would complete -
 * requiring the previously-typed part of the closing run (rung - 1 literal
 * characters) to sit directly before the caret. Both runs must be exact
 * (not the tail of a longer run), and the enclosed value must be non-empty
 * with no whitespace at its edges and no delimiter characters inside. This
 * is what lets literal "**hello"-looking text - left by deleting a
 * delimiter, a paste, or an abandoned edit - re-form into a real node when
 * its closing delimiter is (re)typed.
 */
export function findRunOpen(
  textBefore: string,
  char: string,
  rung: number,
): { openIdx: number; value: string } | null {
  const closerStart = textBefore.length - (rung - 1);
  if (closerStart < 0) return null;
  if (textBefore.slice(closerStart) !== char.repeat(rung - 1)) return null;
  if (textBefore[closerStart - 1] === char) return null; // tail of a longer literal run - not this rung's closer
  const body = textBefore.slice(0, closerStart);
  const openIdx = body.lastIndexOf(char.repeat(rung));
  if (openIdx === -1) return null;
  if (body[openIdx - 1] === char || body[openIdx + rung] === char) return null; // embedded in a longer run
  const value = body.slice(openIdx + rung);
  if (!isValidRunValue(value, char)) return null;
  return { openIdx, value };
}

/**
 * Forward mirror of findRunOpen: the character being typed right now
 * completes an OPENING run of exactly `rung` characters (the other rung - 1
 * sit directly before the caret, typed just previously), and a closing run
 * of exactly the same length already waits in the literal text ahead - the
 * "add the delimiters around existing content, front first" direction.
 * Runs must match in exact length: with "hello**" ahead, the first "*"
 * typed in front stays literal (1 vs 2) and the second completes the pair.
 * The cost of that determinism: with "hello*" ahead a single "*" pairs to
 * italic immediately, even if the user meant to keep going to bold - an
 * inherently ambiguous input either way.
 */
export function findRunClose(
  textBefore: string,
  textAfter: string,
  char: string,
  rung: number,
): { valueLen: number } | null {
  const openStart = textBefore.length - (rung - 1);
  if (openStart < 0) return null;
  if (textBefore.slice(openStart) !== char.repeat(rung - 1)) return null;
  if (textBefore[openStart - 1] === char) return null; // tail of a longer literal run
  const closeIdx = textAfter.indexOf(char.repeat(rung));
  if (closeIdx === -1) return null;
  if (textAfter[closeIdx + rung] === char) return null; // part of a longer run ahead
  const value = textAfter.slice(0, closeIdx);
  if (!isValidRunValue(value, char)) return null;
  return { valueLen: closeIdx };
}

/**
 * Whether an opening run longer than the characters typed so far is waiting
 * for more closing characters - e.g. "**hello" with one "*" just typed. In
 * that case the typed character must stay literal (building up the closing
 * run one keystroke at a time) instead of opening a fresh unrelated shell,
 * or the multi-character closer could never be typed at all.
 */
export function hasPendingRunOpen(
  textBefore: string,
  char: string,
  minRung: number,
  maxRung: number,
): boolean {
  let trailing = 0;
  while (
    trailing < textBefore.length &&
    textBefore[textBefore.length - 1 - trailing] === char
  )
    trailing++;
  for (let rung = Math.max(minRung, 2); rung <= maxRung; rung++) {
    if (trailing >= rung - 1) continue; // this keystroke already completes that rung (findRunOpen's case)
    const body = textBefore.slice(0, textBefore.length - trailing);
    const openIdx = body.lastIndexOf(char.repeat(rung));
    if (openIdx === -1) continue;
    if (body[openIdx - 1] === char || body[openIdx + rung] === char) continue;
    const value = body.slice(openIdx + rung);
    if (!isValidRunValue(value, char)) continue;
    return true;
  }
  return false;
}
