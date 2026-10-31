import type { Node as ProseNode, Schema } from "@milkdown/kit/prose/model";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { findRunClose, findRunOpen, literalTextAfter } from "./enclosure";
import { caretAt } from "../live-selection";

/** The spans a typed delimiter pairs, and the text run a closing one turns
 *  into its node. */

export interface SpanSpec {
  char: string;
  nodeType: "md_span" | "md_code_span";
  minRung: number;
  maxRung: number;
}

// "*" covers italic, bold and bold-italic: typed again in an empty shell it
// upgrades the rung. "~" and "=" only have a 2-character form. "`" is its
// own node type, since code holds no nested formatting.
export const SPECS: SpanSpec[] = [
  { char: "*", nodeType: "md_span", minRung: 1, maxRung: 3 },
  { char: "~", nodeType: "md_span", minRung: 2, maxRung: 2 },
  { char: "=", nodeType: "md_span", minRung: 2, maxRung: 2 },
  { char: "`", nodeType: "md_code_span", minRung: 1, maxRung: 1 },
];

export function isOurNode(name: string): boolean {
  return name === "md_span" || name === "md_code_span";
}

/**
 * Whether `spec`'s delimiter typed in `parent` may make a node: in a
 * paragraph or heading, and code inside other spans too. Never inside code
 * or maths, and no span in a span of another kind.
 */
export function pairsIn(parent: ProseNode, spec: SpanSpec): boolean {
  if (parent.type.name === "md_span") return spec.nodeType === "md_code_span";
  if (isOurNode(parent.type.name)) return false;
  return parent.isTextblock && !parent.type.spec.code;
}

/** The node `spec` makes at `rung` (a code span has no rungs), holding
 *  `text` if given, empty otherwise. */
export function spanNode(
  schema: Schema,
  spec: SpanSpec,
  rung: number,
  text?: string,
): ProseNode {
  const content = text === undefined ? undefined : schema.text(text);
  return spec.nodeType === "md_span"
    ? schema.nodes.md_span.create({ delim: spec.char, rung }, content)
    : schema.nodes.md_code_span.create({}, content);
}

/** The node `spec` makes at `rung` around `from`..`to` in one parent: a span
 *  keeps the code, maths and links in it; code takes it as text. */
export function spanAround(
  state: EditorState,
  spec: SpanSpec,
  rung: number,
  from: number,
  to: number,
  extra: Record<string, unknown> = {},
): ProseNode {
  if (spec.nodeType !== "md_span")
    return spanNode(state.schema, spec, rung, state.doc.textBetween(from, to));
  const $from = state.doc.resolve(from);
  const content = $from.parent.content.cut(
    $from.parentOffset,
    $from.parentOffset + to - from,
  );
  return state.schema.nodes.md_span.create(
    { delim: spec.char, rung, ...extra },
    content,
  );
}

/** Whether `spec`'s runs are read across code and maths. */
export const runsHoldAtoms = (spec: SpanSpec) => spec.nodeType === "md_span";

/**
 * Closes an opening run left in the literal text before the caret with the
 * typed delimiter. Longest rung first, so "**hello**" re-forms bold rather
 * than italic. Returns whether there was a run to close.
 */
export function closeOpenRun(
  view: EditorView,
  spec: SpanSpec,
  textBefore: string,
  runStart: number,
  to: number,
  extra: Record<string, unknown> = {},
): boolean {
  const { state } = view;
  for (let rung = spec.maxRung; rung >= spec.minRung; rung--) {
    const open = findRunOpen(textBefore, spec.char, rung);
    if (!open) continue;
    const absOpen = runStart + open.openIdx;
    const valueStart = absOpen + rung;
    const node = spanAround(
      state,
      spec,
      rung,
      valueStart,
      valueStart + open.value.length,
      extra,
    );
    const tr = state.tr.replaceWith(absOpen, to, node);
    view.dispatch(caretAt(tr, absOpen + node.nodeSize));
    return true;
  }
  return false;
}

/**
 * An opening run typed in front of content whose closing run sits ahead
 * ("**" before "hello**"): the typed run's length picks the rung.
 * `textBefore` ends before the run's last character, which is at
 * `contentStart` - 1 once in the document, or about to go in at `contentStart`.
 */
export function openRunBeforeContent(
  view: EditorView,
  spec: SpanSpec,
  textBefore: string,
  contentStart: number,
  inDoc: boolean,
): boolean {
  let typedRun = 1;
  while (
    typedRun - 1 < textBefore.length &&
    textBefore[textBefore.length - typedRun] === spec.char
  )
    typedRun++;
  if (typedRun < spec.minRung || typedRun > spec.maxRung) return false;
  const { state } = view;
  const $pos = state.doc.resolve(contentStart);
  const { text: textAfter } = literalTextAfter($pos, runsHoldAtoms(spec));
  const close = findRunClose(textBefore, textAfter, spec.char, typedRun);
  if (!close) return false;
  const openStart = contentStart - (inDoc ? typedRun : typedRun - 1);
  const contentEnd = contentStart + close.valueLen;
  const node = spanAround(state, spec, typedRun, contentStart, contentEnd);
  const tr = state.tr.replaceWith(openStart, contentEnd + typedRun, node);
  view.dispatch(caretAt(tr, openStart + 1));
  return true;
}

/** Italic written with underscores, only ever closed, never opened as an
 *  empty shell. */
export const UNDERSCORE: SpanSpec = {
  char: "_",
  nodeType: "md_span",
  minRung: 1,
  maxRung: 1,
};
/** Subscript `~x~` and superscript `^x^`: only ever closed, around text
 *  with no spaces, so `a ~ b` and `2^10` stay as typed; a subscript only
 *  right after a letter or digit (`H~2~O`), as `~text~` strikes out. */
export const SUBSCRIPT: SpanSpec = {
  char: "~",
  nodeType: "md_span",
  minRung: 1,
  maxRung: 1,
};
export const SUPERSCRIPT: SpanSpec = {
  char: "^",
  nodeType: "md_span",
  minRung: 1,
  maxRung: 1,
};

/** The closing delimiter of a subscript or superscript, as Typora reads
 *  them: the span forms only around text without spaces. */
export function closeTightRun(
  view: EditorView,
  spec: SpanSpec,
  textBefore: string,
  runStart: number,
  to: number,
): boolean {
  if (!pairsIn(view.state.doc.resolve(to).parent, spec)) return false;
  const open = findRunOpen(textBefore, spec.char, 1);
  if (!open || /\s/.test(open.value)) return false;
  if (spec === SUBSCRIPT) {
    const before = textBefore.slice(0, open.openIdx).slice(-1);
    if (!LETTER_OR_DIGIT.test(before)) return false;
    return closeOpenRun(view, spec, textBefore, runStart, to, { sub: true });
  }
  return closeOpenRun(view, spec, textBefore, runStart, to);
}

export const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;
/** Closing brackets and quotes, and nothing else. */
export const ONLY_CLOSERS = /^[)\]}"'」』）】》”’]+$/u;

/**
 * The closing "_" of `_italic_`, by CommonMark's rule that underscores open
 * and close only at a word's edges, so snake_case stays text. "_" never
 * opens an empty shell: in a word it is just a character.
 */
export function closeUnderscoreRun(
  view: EditorView,
  textBefore: string,
  runStart: number,
  to: number,
): boolean {
  const $to = view.state.doc.resolve(to);
  if (!pairsIn($to.parent, UNDERSCORE)) return false;
  const open = findRunOpen(textBefore, "_", 1);
  if (!open) return false;
  if (LETTER_OR_DIGIT.test(textBefore.charAt(open.openIdx - 1))) return false;
  const next = literalTextAfter($to).text.charAt(0);
  if (next === "_" || LETTER_OR_DIGIT.test(next)) return false;
  return closeOpenRun(view, UNDERSCORE, textBefore, runStart, to);
}

/** Typing an empty shell's delimiter again: the shell one rung up, or null
 *  at its top rung. */
export function upgradeRung(
  state: EditorState,
  nodeStart: number,
  shell: ProseNode,
  spec: SpanSpec,
): Transaction | null {
  const rung = (shell.attrs.rung as number) ?? spec.minRung;
  if (rung >= spec.maxRung) return null;
  return state.tr.setNodeMarkup(nodeStart, undefined, {
    delim: spec.char,
    rung: rung + 1,
  });
}

/**
 * A third "~" or "=" typed into the empty shell the first two opened: no
 * span takes three, so they stay as typed ("~~~" is a code fence). Null for
 * the other delimiters.
 */
export function threeLiteral(
  state: EditorState,
  nodeStart: number,
  shell: ProseNode,
  spec: SpanSpec,
): Transaction | null {
  if (spec.nodeType !== "md_span" || spec.minRung !== 2) return null;
  const tr = state.tr.replaceWith(
    nodeStart,
    nodeStart + shell.nodeSize,
    state.schema.text(spec.char.repeat(3)),
  );
  return caretAt(tr, nodeStart + 3);
}
