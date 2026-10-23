import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  COMPOSE_RELOCATE_DELAY_MS,
  caretAt,
  findRunClose,
  hasPendingRunOpen,
  isImeKeyEvent,
  literalTextAfter,
  literalTextBefore,
  redirectMisattributedInput,
  stateWithLiveSelection,
} from "./enclosure";
import {
  ONLY_CLOSERS,
  SPECS,
  closeOpenRun,
  closeUnderscoreRun,
  pairsIn,
  runsHoldAtoms,
  spanAround,
  spanNode,
  threeLiteral,
  upgradeRung,
} from "./md-span-runs";
import {
  codeFenceLanguage,
  convertRunClosedBeforeCaret,
  lineStartStars,
  paragraphToBulletItem,
  paragraphToRule,
} from "./md-span-blocks";
export { convertRunClosedBeforeCaret } from "./md-span-blocks";

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

/**
 * What typing a delimiter character does for bold/italic/strikethrough/
 * highlight/inline code: open a fresh empty shell, upgrade an empty shell's
 * rung, close/step past the node the cursor is in, or convert an unclosed
 * literal run left in the text (see enclosure.ts's findRunOpen - this is
 * also how a delimiter deleted via Backspace comes back when retyped).
 * Cursor movement, delimiter reveal, and delimiter deletion all live in
 * enclosure.ts; content editing is fully unintercepted.
 *
 * `autoClose` is Settings > Close ** and ` (#136).
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

            if (text === "_") {
              const { text: before, from: runStart } = literalTextBefore(
                view.state.doc.resolve(from),
                true,
              );
              return closeUnderscoreRun(view, before, runStart, to);
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
                if (tr) {
                  view.dispatch(tr);
                  return true;
                }
                const run = threeLiteral(state, nodeStart, parent, spec);
                if (!run) return false; // a code span, or "****" - literal char as content
                view.dispatch(run);
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
                if (tr) {
                  view.dispatch(caretAt(tr, nodeStart + 1));
                  return true;
                }
                const run = threeLiteral(state, nodeStart, before, spec);
                if (!run) return false;
                view.dispatch(run);
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
            // opening run above still works mid-line.) Closing brackets and
            // quotes don't count: "(" puts in its ")" (bracket-autopair-
            // plugin.ts), and "(**" should open bold inside as at a line end.
            const rest = parent.textBetween(
              $pos.parentOffset,
              parent.content.size,
              "",
              "\uFFFC",
            );
            if (rest && !ONLY_CLOSERS.test(rest)) return false;

            // Everything below opens an empty shell, closing mark and all.
            if (!options.autoClose()) return false;

            if (spec.minRung === 1) {
              const node = spanNode(state.schema, spec, 1);
              const tr = state.tr.replaceWith(from, to, node);
              view.dispatch(caretAt(tr, from + 1));
              return true;
            }

            // "~~" and "==" stay text as typed: an empty strikethrough shown
            // as "~~|~~" read as four tildes from two keys. They become a
            // strikethrough or a highlight once their closing pair is typed
            // (closeOpenRun above), as in Typora.
            return false;
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
