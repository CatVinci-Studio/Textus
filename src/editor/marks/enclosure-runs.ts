import type { Selection } from "@milkdown/kit/prose/state";
import type { Node as ProseNode, ResolvedPos } from "@milkdown/kit/prose/model";
import { spanDelimText } from "./md-span-schema";

/**
 * What an enclosure is (a node shown with its delimiters, `**bold**`), and
 * the literal text runs beside the caret a typed delimiter may open or close.
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

/** The literal delimiters an enclosure node is rendered with, opening and
 *  closing: the same but for LaTeX's `\(...\)` and `\[...\]`. */
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
 * Whether the selection is inside or right beside the node's bounds, so the
 * delimiters stay revealed (and deletable) with the cursor just outside.
 * The math preview must use this same predicate, or the two would overlap.
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
 * whole, as `**a `b` c**` holds its code; left out, a "**" typed after the
 * code never paired with the one before it.
 */
export const RUN_ATOMS = new Set(["md_code_span", "math_inline"]);

/** A RUN_ATOMS node in a run: one character per position, so text offsets
 *  stay document offsets. Neither a delimiter nor a space. */
export const ATOM_CHAR = "￼";

export function runText(node: ProseNode, withAtoms: boolean): string | null {
  if (node.isText) return node.text ?? "";
  if (withAtoms && RUN_ATOMS.has(node.type.name))
    return ATOM_CHAR.repeat(node.nodeSize);
  return null;
}

/**
 * The contiguous run of plain text directly before $pos, stopping at any
 * non-text inline node but, `withAtoms`, code and maths. Pairing must look
 * only at this run: textContent offsets drift from document positions.
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

/** Mirror of literalTextBefore, after $pos. */
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
 *  edges, no delimiter characters inside. Shared by every pairing rule. */
export function isValidRunValue(value: string, char: string): boolean {
  return value.length > 0 && !/^\s|\s$/.test(value) && !value.includes(char);
}

/**
 * An unclosed opening run of exactly `rung` delimiters in `textBefore` that
 * the character being typed completes, with the rest of the closer (rung - 1
 * characters) right before the caret. This is what lets literal "**hello"
 * re-form into a node when its closer is retyped.
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
 * Forward mirror of findRunOpen: the typed character completes an opening
 * run of exactly `rung` and a closing run of the same length waits ahead.
 * Exact lengths: with "hello**" ahead, the first "*" stays literal; with
 * "hello*" ahead, a single "*" pairs to italic at once.
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
 * Whether an opening run longer than the characters typed so far waits for
 * more closers ("**hello" with one "*" typed): the typed character must stay
 * literal, or a multi-character closer could never be typed.
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
