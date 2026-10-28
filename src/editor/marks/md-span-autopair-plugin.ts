import { Plugin, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { fenceLineToBlock } from "../markdown/fence-line";
import {
  COMPOSE_RELOCATE_DELAY_MS,
  findRunClose,
  hasPendingRunOpen,
  literalTextAfter,
  literalTextBefore,
  redirectMisattributedInput,
} from "./enclosure";
import { caretAt, stateWithLiveSelection } from "../live-selection";
import { isImeKeyEvent } from "../keys/ime";
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
 * After a typed delimiter steps out of a filled span, the rest of its
 * closing run is still coming: the second "*" of a hand-typed "**bold**"
 * must be swallowed too. Remembered per view until the next keystroke.
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
 * What typing a delimiter does for bold/italic/strikethrough/highlight/code:
 * open an empty shell, upgrade its rung, step past the node, or convert an
 * unclosed literal run. `autoClose` off, no empty shell is opened: "*" stays
 * literal until the closing run converts the pair.
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
              // Where no list can start, the star stays what was typed, not an italic
              // span around the rest of the line.
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

              // Non-empty: step past it, and expect the rest of a hand-typed closing run.
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

            // WKWebView can normalize the caret from inside an empty shell to just after
            // it; apply the same as the empty branch above, caret back inside.
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
              // Code span: the second "`" becomes the shell's literal content (the "```"
              // fence state).
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

            // A longer opening run still waits for closers ("**hello" with one "*"
            // typed): stay literal so the closer can be built up.
            if (
              hasPendingRunOpen(
                textBefore,
                spec.char,
                spec.minRung,
                spec.maxRung,
              )
            )
              return false;

            // An opening run typed in front of content whose closing run sits ahead
            // ("**" before "hello**"): the typed run's length picks the rung.
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

            // With content after the caret, never open an empty shell mid-text. Closers
            // don't count: "(**" should open bold inside the autopaired ")".
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

            // "~~" and "==" stay text as typed: "~~|~~" read as four tildes from two
            // keys. Their closing pair converts them, as in Typora.
            return false;
          },
          handleDOMEvents: {
            compositionend(view, event) {
              const committed = event.data ?? "";
              // Once the commit is read back in and moved out of any adjacent node.
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
            view.dispatch(
              fenceLineToBlock(state, $from.before(), codeBlock, { language }),
            );
            event.preventDefault();
            return true;
          },
          decorations: fenceDecoration,
        },
      }),
  );

/** The backtick between "```" on a line of its own is the fence, waiting
 *  for a language, not code: drawn as plain text (.is-fence). */
function fenceDecoration(state: EditorState): DecorationSet | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const block = $from.node(depth);
    if (!block.isTextblock) continue;
    if (block.type.name !== "paragraph" || codeFenceLanguage(block) === null)
      return null;
    const first = block.firstChild;
    if (first?.type.name !== "md_code_span") return null;
    const start = $from.start(depth);
    return DecorationSet.create(state.doc, [
      Decoration.node(start, start + first.nodeSize, { class: "is-fence" }),
    ]);
  }
  return null;
}
