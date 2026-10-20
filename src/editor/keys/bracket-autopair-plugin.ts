import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type {
  Node as ProseNode,
  ResolvedPos,
  Slice,
} from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import {
  COMPOSE_RELOCATE_DELAY_MS,
  isImeKeyEvent,
  stateWithLiveSelection,
} from "../marks/enclosure";
import { typedLinkEndingAt } from "../markdown/link-input-rule";

/** Each opening bracket or quote and the partner typed after it. The
 *  full-width ones are what Chinese and Japanese input methods commit. */
export const BRACKET_PAIRS: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "「": "」",
  "『": "』",
  "（": "）",
  "【": "】",
  "《": "》",
  "“": "”",
  "‘": "’",
};

/** How long after compositionend a committed bracket is paired: once
 *  prosemirror-view has read the commit back in and enclosure.ts has
 *  moved it out of an adjacent node. */
export const BRACKET_COMPOSITION_DELAY_MS = COMPOSE_RELOCATE_DELAY_MS + 10;

const WORD_CHAR = /^[\p{L}\p{N}_]$/u;
/** The text before the caret ends in a web address being typed. */
const URL_BEFORE = /(?:^|\s)(?:[a-z][\w+.-]*:\/\/|www\.)\S*$/iu;

/** A closing partner put in by this plugin, still where it was put: the
 *  opener at `open`, the closer at `close`, the caret between them. */
interface Pair {
  open: number;
  close: number;
  closer: string;
  /** The opener is gone: a rule took it, as a typed link's does with the
   *  rest of `[text](url)` when an input method commits the ")". Only
   *  that closer is still stepped over. */
  orphan?: boolean;
}

const pairsKey = new PluginKey<Pair[]>("bracket-autopair");

const INLINE_NODE = "\uFFFC";

/** The character after `$pos`: "" at the end of its line and INLINE_NODE
 *  for an inline node that isn't text (a span, a formula, an image).
 *  nodeAfter and nodeBefore are cut at `$pos`. */
function charAfter($pos: ResolvedPos): string {
  const node = $pos.nodeAfter;
  if (!node || node.type.name === "hardbreak") return "";
  return node.isText ? node.text!.charAt(0) : INLINE_NODE;
}

function charBefore($pos: ResolvedPos): string {
  const node = $pos.nodeBefore;
  if (!node || node.type.name === "hardbreak") return "";
  return node.isText ? node.text!.slice(-1) : INLINE_NODE;
}

function charAt(doc: ProseNode, pos: number): string {
  if (pos < 0 || pos >= doc.content.size) return "";
  return charAfter(doc.resolve(pos));
}

/** Text where brackets are typed as they are: code, maths, raw HTML and the
 *  other verbatim nodes, and link text, whose address may be what is
 *  being typed. */
function isVerbatim($pos: ResolvedPos): boolean {
  const parent = $pos.parent;
  if (!parent.isTextblock && !parent.isInline) return true;
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.spec.code || node.type.name === "math_inline") return true;
  }
  return $pos.marks().some((mark) => mark.type.name === "link");
}

/**
 * Whether an `opener` standing (or about to stand) right before `$after`
 * gets its partner: not in verbatim text, not right before a word or an
 * inline node (the bracket is being put around what follows, which the
 * user will close themselves), not in a web address, and a `'` not after a
 * word, where it is an apostrophe: don't, it's.
 */
function pairsHere(
  $after: ResolvedPos,
  opener: string,
  before: string,
): boolean {
  if (isVerbatim($after)) return false;
  const next = charAfter($after);
  if (next === INLINE_NODE || WORD_CHAR.test(next)) return false;
  if (opener === "'" && (before === INLINE_NODE || WORD_CHAR.test(before)))
    return false;
  const textBefore = $after.parent.textBetween(
    0,
    $after.parentOffset,
    undefined,
    INLINE_NODE,
  );
  return !URL_BEFORE.test(textBefore);
}

function pairsOf(state: EditorState): Pair[] {
  return pairsKey.getState(state) ?? [];
}

function track(tr: Transaction, pair: Pair): Transaction {
  return tr.setMeta(pairsKey, pair);
}

/** The pair whose untouched closer stands at `pos`. */
function pairClosingAt(state: EditorState, pos: number): Pair | undefined {
  return pairsOf(state).find((pair) => pair.close === pos);
}

/** Typing `opener` over a selection in one textblock: the selection,
 *  kept selected, between the opener and its partner. */
function wrap(
  tr: Transaction,
  from: number,
  to: number,
  opener: string,
  content?: Slice,
): Transaction {
  const closer = BRACKET_PAIRS[opener];
  if (content) tr.replace(from, from, content);
  const end = content ? from + content.size : to;
  tr.insertText(closer, end).insertText(opener, from);
  return tr.setSelection(TextSelection.create(tr.doc, from + 1, end + 1));
}

/** After an input method committed `committed` at the caret: the same as
 *  typing its last character would have done. `wrapped` is what the
 *  composition replaced, if it began over a selection. */
export function pairAfterComposition(
  view: EditorView,
  committed: string,
  wrapped?: { from: number; content: Slice; sizeAfter: number },
): boolean {
  const { state } = view;
  const sel = state.selection;
  if (!sel.empty || !committed) return false;
  const typed = [...committed].at(-1)!;
  const caret = sel.from;
  const typedBefore = charAt(state.doc, caret - typed.length) === typed;

  // The closer typed in front of a closer this plugin put in: one closer.
  // Or taken by a rule with its opener (an orphan): none left over.
  const pair = pairClosingAt(state, caret);
  if (
    pair?.closer === typed &&
    charAt(state.doc, caret) === typed &&
    (typedBefore || pair.orphan)
  ) {
    view.dispatch(state.tr.delete(caret, caret + typed.length));
    return true;
  }
  if (!typedBefore) return false;

  const closer = BRACKET_PAIRS[typed];
  if (!closer) return false;
  const open = caret - typed.length;
  if (pairsOf(state).some((p) => p.open === open)) return false; // paired already
  if (
    wrapped &&
    committed === typed &&
    wrapped.from === open &&
    state.doc.content.size === wrapped.sizeAfter
  ) {
    // The opener stands where the selection was; put the selection back
    // after it, and the partner after that.
    const tr = state.tr.delete(open, caret);
    view.dispatch(
      track(wrap(tr, open, open, typed, wrapped.content), {
        open,
        close: open + 1 + wrapped.content.size,
        closer,
      }),
    );
    return true;
  }
  const $open = state.doc.resolve(open);
  if (!pairsHere(state.doc.resolve(caret), typed, charBefore($open)))
    return false;
  const tr = state.tr.insertText(closer, caret);
  tr.setSelection(TextSelection.create(tr.doc, caret));
  view.dispatch(track(tr, { open, close: caret, closer }));
  return true;
}

/**
 * Brackets and quotes typed with their partner, as in Typora and code
 * editors: `(` puts in `)` after the caret, the `)` typed in front of it
 * steps over it rather than doubling it, Backspace right after the `(`
 * takes both while nothing was typed between them, and an opener typed over
 * a selection wraps it. Only a partner this plugin put in is stepped over
 * or deleted with its opener; every other closer is typed as it is.
 *
 * Input methods commit their brackets (`（`, `【`, `「`, `“`...) through a
 * composition, which nothing may disturb while it runs, so those are
 * paired once it has ended, the same way.
 *
 * `enabled` is Settings > Close (), [] and “”.
 */
export const createBracketAutopairPlugin = (options: {
  enabled: () => boolean;
}) =>
  $prose(() => {
    let wrapped:
      { from: number; content: Slice; sizeAfter: number } | undefined;
    return new Plugin<Pair[]>({
      key: pairsKey,
      state: {
        init: () => [],
        apply(tr, pairs, _old, state) {
          if (!pairs.length && !tr.getMeta(pairsKey)) return pairs;
          const added = tr.getMeta(pairsKey) as Pair | undefined;
          const next: Pair[] = [];
          for (const pair of added ? [...pairs, added] : pairs) {
            let mapped = pair;
            if (pair !== added) {
              const open = tr.mapping.mapResult(pair.open, -1);
              mapped = {
                ...pair,
                open: open.pos,
                close: tr.mapping.map(pair.close, 1),
                orphan: pair.orphan || open.deleted,
              };
            }
            const { from, to } = state.selection;
            if (
              mapped.close > mapped.open &&
              from > mapped.open &&
              to <= mapped.close &&
              (mapped.orphan ||
                BRACKET_PAIRS[charAt(state.doc, mapped.open)] ===
                  mapped.closer) &&
              charAt(state.doc, mapped.close) === mapped.closer
            )
              next.push(mapped);
          }
          return next;
        },
      },
      // A ")" put in after `[text](url` is a link's end the user never
      // typed: moving on past it - an arrow, End, a click - makes the link,
      // as typing it would have (link-input-rule.ts).
      appendTransaction(trs, oldState, newState) {
        const before = pairsOf(oldState).filter(
          (pair) => pair.closer === ")" && !pair.orphan,
        );
        if (!before.length) return null;
        const after = pairsOf(newState);
        for (const pair of before) {
          let close = pair.close;
          for (const tr of trs) close = tr.mapping.map(close, 1);
          if (after.some((p) => p.close === close)) continue;
          if (charAt(newState.doc, close) !== ")") continue;
          const tr = typedLinkEndingAt(newState, close + 1);
          if (tr) return tr;
        }
        return null;
      },
      props: {
        handleTextInput(view, from, to, text) {
          // Dispatching mid-composition aborts the input method's preedit;
          // compositionend below takes over.
          if (view.composing || !options.enabled()) return false;
          const { state } = view;

          if (from === to) {
            const pair = pairClosingAt(state, from);
            if (pair && pair.closer === text) {
              // Take out the partner put in and let the typed closer go
              // in as usual, so the rules that act on it (a typed link's
              // ")", a wikilink's "]]") still see it.
              view.dispatch(state.tr.delete(from, from + text.length));
              return false;
            }
          }

          const closer = BRACKET_PAIRS[text];
          if (!closer) return false;
          const $from = state.doc.resolve(from);
          if (from !== to) {
            const $to = state.doc.resolve(to);
            if (!$from.sameParent($to) || isVerbatim($from)) return false;
            view.dispatch(
              track(wrap(state.tr, from, to, text), {
                open: from,
                close: to + 1,
                closer,
              }),
            );
            return true;
          }
          if (!pairsHere($from, text, charBefore($from))) return false;
          const tr = state.tr.insertText(text + closer, from);
          tr.setSelection(TextSelection.create(tr.doc, from + 1));
          view.dispatch(
            track(tr.scrollIntoView(), { open: from, close: from + 1, closer }),
          );
          return true;
        },
        handleKeyDown(view, event) {
          // Enter right before a ")" put in after `[text](url`: the link
          // first, then the new line after it - not the ")" carried down.
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !isImeKeyEvent(view, event)
          ) {
            const state = stateWithLiveSelection(view);
            const { from, empty } = state.selection;
            const pair = empty && pairClosingAt(state, from);
            if (!pair || pair.closer !== ")" || pair.orphan) return false;
            const tr = typedLinkEndingAt(state, from + 1);
            if (tr) view.dispatch(tr);
            return false;
          }
          if (
            event.key !== "Backspace" ||
            event.shiftKey ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            isImeKeyEvent(view, event)
          )
            return false;
          const state = stateWithLiveSelection(view);
          const { from, empty } = state.selection;
          if (!empty) return false;
          const pair = pairsOf(state).find(
            (p) => !p.orphan && p.open === from - 1 && p.close === from,
          );
          if (!pair) return false;
          view.dispatch(state.tr.delete(from - 1, from + 1));
          event.preventDefault();
          return true;
        },
        handleDOMEvents: {
          compositionstart(view) {
            const { state } = view;
            const { from, to, empty, $from, $to } = state.selection;
            wrapped =
              !empty &&
              state.selection instanceof TextSelection &&
              $from.sameParent($to) &&
              !isVerbatim($from)
                ? {
                    from,
                    content: state.doc.slice(from, to),
                    // An opener in place of the selection.
                    sizeAfter: state.doc.content.size - (to - from) + 1,
                  }
                : undefined;
            return false;
          },
          compositionend(view, event) {
            const committed = event.data ?? "";
            const pending = wrapped;
            wrapped = undefined;
            // prosemirror-view reads the committed text in a moment after
            // this event (WebKitGTK as deleteCompositionText, then
            // insertFromComposition); look once it has.
            setTimeout(() => {
              if (view.composing || view.isDestroyed || !options.enabled())
                return;
              pairAfterComposition(view, committed, pending);
            }, BRACKET_COMPOSITION_DELAY_MS);
            return false;
          },
        },
      },
    });
  });
