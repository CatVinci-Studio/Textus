import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { canJoin, findWrapping } from "@milkdown/kit/prose/transform";
import type { Node as ProseNode, Schema } from "@milkdown/kit/prose/model";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  COMPOSE_RELOCATE_DELAY_MS,
  caretAt,
  findRunClose,
  findRunOpen,
  hasPendingRunOpen,
  isImeKeyEvent,
  literalTextAfter,
  literalTextBefore,
  redirectMisattributedInput,
  stateWithLiveSelection,
} from "./enclosure";

interface SpanSpec {
  char: string;
  nodeType: "md_span" | "md_code_span";
  minRung: number;
  maxRung: number;
}

// "*" covers italic(1)/bold(2)/bold+italic(3) - typing it again while the
// shell is still empty upgrades the rung. "~" and "=" only have a 2-character
// form, so a lone one is left as literal text until a second, matching one
// completes it. "`" is its own node type (see md-span-schema.ts) since code
// content must never contain nested formatting.
const SPECS: SpanSpec[] = [
  { char: "*", nodeType: "md_span", minRung: 1, maxRung: 3 },
  { char: "~", nodeType: "md_span", minRung: 2, maxRung: 2 },
  { char: "=", nodeType: "md_span", minRung: 2, maxRung: 2 },
  { char: "`", nodeType: "md_code_span", minRung: 1, maxRung: 1 },
];

/**
 * After a typed delimiter steps the caret out of a filled span, the rest of
 * that span's closing run is still on its way: someone typing "**bold**" by
 * hand presses "*" twice at the end, and the second one must be swallowed
 * too, not open a fresh italic shell (or, for "~~", land as a literal "~").
 * Remembered per view until the next keystroke that isn't that delimiter at
 * that spot in that same document.
 */
interface PendingCloser {
  doc: ProseNode;
  pos: number;
  char: string;
  remaining: number;
}
const pendingClosers = new WeakMap<EditorView, PendingCloser>();

function swallowPendingCloser(
  view: EditorView,
  from: number,
  text: string,
): boolean {
  const pending = pendingClosers.get(view);
  if (!pending) return false;
  pendingClosers.delete(view);
  if (
    pending.doc !== view.state.doc ||
    pending.pos !== from ||
    pending.char !== text ||
    pending.remaining <= 0
  )
    return false;
  if (pending.remaining > 1)
    pendingClosers.set(view, { ...pending, remaining: pending.remaining - 1 });
  // Nothing to change, but the caret may have been normalized elsewhere.
  if (view.state.selection.from !== from)
    view.dispatch(caretAt(view.state.tr, from));
  return true;
}

function isOurNode(name: string): boolean {
  return name === "md_span" || name === "md_code_span";
}

/**
 * Whether `spec`'s delimiter typed in `parent` may make a node: in a
 * paragraph or heading, and code in bold, italic, strikethrough or
 * highlight too - `**a `b` c**`, which the file reads as. Never inside code
 * or maths, whose text is verbatim, and no span in a span of another kind.
 */
function pairsIn(parent: ProseNode, spec: SpanSpec): boolean {
  if (parent.type.name === "md_span") return spec.nodeType === "md_code_span";
  if (isOurNode(parent.type.name)) return false;
  return parent.isTextblock && !parent.type.spec.code;
}

/** The node `spec` makes at `rung` (a code span has no rungs), holding
 *  `text` if given, empty otherwise. */
function spanNode(
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

/** The node `spec` makes at `rung` around what stands from `from` to `to`
 *  in one parent: a span keeps the code, maths and links in it (see
 *  literalTextBefore's `withAtoms`); code takes it as text. */
function spanAround(
  state: EditorState,
  spec: SpanSpec,
  rung: number,
  from: number,
  to: number,
): ProseNode {
  if (spec.nodeType !== "md_span")
    return spanNode(state.schema, spec, rung, state.doc.textBetween(from, to));
  const $from = state.doc.resolve(from);
  const content = $from.parent.content.cut(
    $from.parentOffset,
    $from.parentOffset + to - from,
  );
  return state.schema.nodes.md_span.create({ delim: spec.char, rung }, content);
}

/** Whether `spec`'s runs are read across code and maths. */
const runsHoldAtoms = (spec: SpanSpec) => spec.nodeType === "md_span";

/**
 * Closes an opening run left in the literal text before the caret
 * (`textBefore`, starting at `runStart`) with the delimiter being typed:
 * from that opener to `to` becomes one span. Longest rung first, so
 * "**hello" + "*" + "*" re-forms bold rather than italic. Returns whether
 * there was a run to close.
 */
function closeOpenRun(
  view: EditorView,
  spec: SpanSpec,
  textBefore: string,
  runStart: number,
  to: number,
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
    );
    const tr = state.tr.replaceWith(absOpen, to, node);
    view.dispatch(caretAt(tr, absOpen + node.nodeSize));
    return true;
  }
  return false;
}

/** Typing an empty shell's delimiter again: the shell (an md_span at
 *  `nodeStart`) one rung up, "*" to "**" - or null at its top rung. */
function upgradeRung(
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
 * Whether a paragraph is a "```" (or "```lang") code-fence line, returning
 * the language ("" for none) or null if it isn't one. Typing three backticks
 * doesn't leave literal "```" text - the autopair turns the first two into a
 * code span holding one literal backtick and the third closes it - so the
 * fence shape to recognize at Enter time is that node, optionally followed
 * by a language word. A literal "```lang" run (left by a paste or by
 * deleting a delimiter) counts too.
 */
function codeFenceLanguage(paragraph: ProseNode): string | null {
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
    const match = /^```(.*)$/.exec(first.text ?? "");
    if (!match) return null;
    rest = match[1];
  } else {
    return null;
  }
  const language = rest.trim();
  return /\s/.test(language) ? null : language;
}

/**
 * An empty "*" shell that is all its paragraph holds: what "*" or "***" at
 * the start of a line leaves, the autopair having taken the stars. Those
 * are a list marker and a rule there, as "-" and "---" are; returns the
 * shell's rung and the paragraph's position, or null.
 */
function lineStartStars(
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
function paragraphToRule(
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

/** The paragraph at `paragraphPos`, emptied, as the first item of a
 *  bullet list - joined to a bullet list right above, as "- " does. */
function paragraphToBulletItem(
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
 * The IME counterpart of the run-closing path in handleTextInput below.
 * Several Windows IMEs in Chinese mode (Microsoft Pinyin, Sogou) deliver
 * even a plain "*" through a composition, and handleTextInput must stay out
 * of the way while one is active (dispatching aborts the preedit), so a
 * "**加粗文本**" written that way used to stay literal text (#134). Once the
 * composition has been committed, look at the text before the caret: if it
 * ends in a complete closing run that pairs with an opening run left in the
 * same literal text, convert the pair exactly as typing the last delimiter
 * would have. Only full pairs are converted - nothing opens an empty shell
 * after the fact - so a lone "*" committed this way stays literal until its
 * partner arrives. `committed` is the composition's text: unless it ends
 * in the delimiter, the closing run was already there (say, literal text
 * left by a paste) and is not the user's to convert now. Returns whether it
 * converted anything.
 */
export function convertRunClosedBeforeCaret(
  view: EditorView,
  committed: string,
): boolean {
  const { state } = view;
  const sel = state.selection;
  if (!sel.empty) return false;
  const $pos = sel.$from;
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

/**
 * What typing a delimiter character does for bold/italic/strikethrough/
 * highlight/inline code: open a fresh empty shell, upgrade an empty shell's
 * rung, close/step past the node the cursor is in, or convert an unclosed
 * literal run left in the text (see enclosure.ts's findRunOpen - this is
 * also how a delimiter deleted via Backspace comes back when retyped).
 * Cursor movement, delimiter reveal, and delimiter deletion all live in
 * enclosure.ts; content editing is fully unintercepted.
 *
 * `autoClose` is Settings > Close formatting marks automatically (#136).
 * Off, a delimiter never opens an empty shell - the only step that puts a
 * closing mark in before the user types it - so "*" and "**" stay literal
 * until the user types the closing run, which then converts the pair
 * exactly as it does for literal text today (and as the IME path does).
 */
export const createMdSpanAutopairPlugin = (options: {
  autoClose: () => boolean;
}) =>
  $prose(
    () =>
      new Plugin({
        props: {
          handleTextInput(view, from, to, text) {
            if (view.composing) return false; // dispatching mid-composition aborts the IME preedit
            if (from !== to) return false;
            if (redirectMisattributedInput(view, from, to, text)) return true;
            if (swallowPendingCloser(view, from, text)) return true;

            if (text === " ") {
              const stars = lineStartStars(view.state.doc.resolve(from));
              const tr =
                stars?.rung === 1
                  ? paragraphToBulletItem(view.state, stars.paragraphPos)
                  : stars?.rung === 3
                    ? paragraphToRule(view.state, stars.paragraphPos)
                    : null;
              if (tr) {
                view.dispatch(tr);
                return true;
              }
              // Where no list can start (a list item's first line), the
              // star stays what was typed, as a dash does there - not an
              // italic span around the rest of the line.
              if (stars?.rung === 1) {
                const literal = view.state.tr.replaceWith(
                  from - 1,
                  from + 1,
                  view.state.schema.text("* "),
                );
                view.dispatch(caretAt(literal, from + 1));
                return true;
              }
            }

            const spec = SPECS.find((s) => s.char === text);
            if (!spec) return false;

            const { state } = view;
            const $pos = state.doc.resolve(from);
            const parent = $pos.parent;

            const isMatchingNode =
              parent.type.name === spec.nodeType &&
              (spec.nodeType !== "md_span" || parent.attrs.delim === spec.char);

            if (isMatchingNode) {
              const atContentEnd = $pos.parentOffset === parent.content.size;
              if (!atContentEnd) return false; // literal char mid-content

              const nodeStart = $pos.before($pos.depth);
              const nodeEnd = nodeStart + parent.nodeSize;

              if (parent.content.size === 0) {
                const tr =
                  spec.nodeType === "md_span" &&
                  upgradeRung(state, nodeStart, parent, spec);
                if (!tr) return false; // already at max rung (or a code span) - literal char as content
                view.dispatch(tr);
                return true;
              }

              // Non-empty - already a valid node, just step past it, and
              // expect the rest of a hand-typed closing run to follow.
              view.dispatch(caretAt(state.tr, nodeEnd));
              const rung =
                spec.nodeType === "md_span"
                  ? ((parent.attrs.rung as number) ?? spec.minRung)
                  : 1;
              if (rung > 1)
                pendingClosers.set(view, {
                  doc: view.state.doc,
                  pos: nodeEnd,
                  char: spec.char,
                  remaining: rung - 1,
                });
              return true;
            }

            // WKWebView can normalize the caret from inside an empty shell to
            // just after it, so the delimiter that should upgrade/fill the
            // shell arrives attributed to the paragraph instead. Apply the
            // same semantics as the isMatchingNode-empty branch above, then
            // put the caret back inside where the user expects to type.
            const before = $pos.nodeBefore;
            if (
              before &&
              before.type.name === spec.nodeType &&
              before.content.size === 0 &&
              (spec.nodeType !== "md_span" || before.attrs.delim === spec.char)
            ) {
              const nodeStart = from - before.nodeSize;
              if (spec.nodeType === "md_span") {
                const tr = upgradeRung(state, nodeStart, before, spec);
                if (!tr) return false;
                view.dispatch(caretAt(tr, nodeStart + 1));
                return true;
              }
              // Code span: the second "`" becomes the shell's literal content
              // (the "```" fence state - see codeFenceLanguage above).
              const tr = state.tr.insertText(spec.char, nodeStart + 1);
              view.dispatch(caretAt(tr, nodeStart + 2));
              return true;
            }

            if (!pairsIn(parent, spec)) return false;

            const withAtoms = runsHoldAtoms(spec);
            const { text: textBefore, from: runStart } = literalTextBefore(
              $pos,
              withAtoms,
            );

            if (closeOpenRun(view, spec, textBefore, runStart, to)) return true;

            // A longer opening run is still waiting for more closing chars
            // (e.g. "**hello" with only one "*" typed so far) - stay literal
            // so the multi-character closer can be built up keystroke by
            // keystroke instead of spawning an unrelated fresh shell.
            if (
              hasPendingRunOpen(
                textBefore,
                spec.char,
                spec.minRung,
                spec.maxRung,
              )
            )
              return false;

            // Complete an opening run typed in FRONT of existing content whose
            // matching closing run already sits ahead in the literal text -
            // the forward mirror of the findRunOpen path above ("**" typed
            // before "hello**" forms bold on the second "*"). The typed run's
            // length picks the rung; see findRunClose for the exact-length
            // matching rule.
            let typedRun = 1;
            while (
              typedRun - 1 < textBefore.length &&
              textBefore[textBefore.length - typedRun] === spec.char
            )
              typedRun++;
            if (typedRun >= spec.minRung && typedRun <= spec.maxRung) {
              const { text: textAfter } = literalTextAfter($pos, withAtoms);
              const close = findRunClose(
                textBefore,
                textAfter,
                spec.char,
                typedRun,
              );
              if (close) {
                const openStart = from - (typedRun - 1);
                const node = spanAround(
                  state,
                  spec,
                  typedRun,
                  to,
                  to + close.valueLen,
                );
                const tr = state.tr.replaceWith(
                  openStart,
                  to + close.valueLen + typedRun,
                  node,
                );
                view.dispatch(caretAt(tr, openStart + 1));
                return true;
              }
            }

            // With content still following the caret the character is being
            // typed into the middle of existing text - never spawn a fresh
            // empty shell there, keep it literal. (Closing/converting an
            // opening run above still works mid-line.)
            if ($pos.parentOffset !== parent.content.size) return false;

            // Everything below opens an empty shell, closing mark and all.
            if (!options.autoClose()) return false;

            if (spec.minRung === 1) {
              const node = spanNode(state.schema, spec, 1);
              const tr = state.tr.replaceWith(from, to, node);
              view.dispatch(caretAt(tr, from + 1));
              return true;
            }

            // minRung > 1 ("~", "="): only open once this many consecutive
            // matching chars have just been typed literally; otherwise let this
            // one insert as plain text and check again next keystroke. The
            // check runs against the contiguous literal run only - a doc-wide
            // position range could reach across a node boundary.
            const need = spec.minRung - 1;
            if (!textBefore.endsWith(spec.char.repeat(need))) return false;
            const precedingStart = from - need;

            const node = spanNode(state.schema, spec, spec.minRung);
            const tr = state.tr.delete(precedingStart, from);
            tr.replaceWith(precedingStart, precedingStart, node);
            view.dispatch(caretAt(tr, precedingStart + 1));
            return true;
          },
          handleDOMEvents: {
            compositionend(view, event) {
              const committed = event.data ?? "";
              // prosemirror-view reads the committed text back in a moment
              // after this event, and enclosure.ts may move it out of an
              // adjacent node; look once both have happened.
              setTimeout(() => {
                if (view.composing || view.isDestroyed) return;
                convertRunClosedBeforeCaret(view, committed);
              }, COMPOSE_RELOCATE_DELAY_MS + 10);
              return false;
            },
          },
          handleKeyDown(view, event) {
            if (event.key !== "Enter" || isImeKeyEvent(view, event))
              return false;
            const state = stateWithLiveSelection(view);
            const { $from, empty } = state.selection;
            if (!empty) return false;
            const stars = lineStartStars($from);
            const rule =
              stars?.rung === 3 && paragraphToRule(state, stars.paragraphPos);
            if (rule) {
              view.dispatch(rule.scrollIntoView());
              event.preventDefault();
              return true;
            }
            const parent = $from.parent;
            if (parent.type.name !== "paragraph") return false;
            if ($from.parentOffset !== parent.content.size) return false; // fence must be what was just typed
            const language = codeFenceLanguage(parent);
            if (language === null) return false;

            const codeBlock = state.schema.nodes.code_block;
            if (!codeBlock) return false;
            const paragraphPos = $from.before($from.depth);
            const tr = state.tr
              .delete(paragraphPos + 1, paragraphPos + 1 + parent.content.size)
              .setNodeMarkup(paragraphPos, codeBlock, { language });
            view.dispatch(caretAt(tr, paragraphPos + 1));
            event.preventDefault();
            return true;
          },
        },
      }),
  );
