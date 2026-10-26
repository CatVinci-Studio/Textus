import { useCallback, useRef, useState, type MouseEvent } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Decoration } from "@milkdown/kit/prose/view";
import {
  grammarIssueAt,
  grammarKey,
  ignoreGrammarIssue,
  type GrammarDecorationSpec,
} from "./grammar-check-plugin";
import { findUniqueTextRange } from "../doc-text";
import { grammarKind } from "./grammar-kind";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { GrammarPopoverInfo } from "./GrammarPopover";
import type { EditorRunner } from "../../editor/useEditorRunner";

/** The popover for one underline, placed at (x, y), with where it stands
 *  among the paragraph's other underlines. */
function popoverFor(
  deco: Decoration,
  x: number,
  y: number,
  siblings: Decoration[] = [deco],
  state?: EditorState,
): GrammarPopoverInfo {
  const spec = deco.spec as GrammarDecorationSpec;
  const shown = state ? withContext(state, deco, spec) : null;
  const index = siblings.findIndex(
    (d) => d.from === deco.from && d.to === deco.to,
  );
  return {
    x,
    y,
    from: deco.from,
    to: deco.to,
    issue: spec.issue,
    suggestion: spec.suggestion,
    original: spec.original,
    kind: grammarKind(spec.original, spec.suggestion, spec.rule),
    shownOriginal: shown?.original,
    shownSuggestion: shown?.suggestion,
    index: Math.max(0, index),
    count: siblings.length,
  };
}

const CJK_CHAR =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;

/** A one-character CJK fix (必 -> 毕 for 必竟) shown with its neighbour on
 *  the card, while Apply still changes only the one. */
function withContext(
  state: EditorState,
  deco: Decoration,
  spec: GrammarDecorationSpec,
): { original: string; suggestion: string } | null {
  const original = spec.original ?? "";
  if ([...original].length !== 1 || !CJK_CHAR.test(original)) return null;
  const $pos = state.doc.resolve(deco.from);
  const end = $pos.end();
  const start = $pos.start();
  const next = deco.to < end ? state.doc.textBetween(deco.to, deco.to + 1) : "";
  if (CJK_CHAR.test(next))
    return { original: original + next, suggestion: spec.suggestion + next };
  const prev =
    deco.from > start ? state.doc.textBetween(deco.from - 1, deco.from) : "";
  if (CJK_CHAR.test(prev))
    return { original: prev + original, suggestion: prev + spec.suggestion };
  return null;
}

/** The underlines in the same paragraph as `deco`, in order. */
function siblingsOf(state: EditorState, deco: Decoration): Decoration[] {
  const $pos = state.doc.resolve(deco.from);
  const start = $pos.start();
  const end = $pos.end();
  return ((grammarKey.getState(state)?.find(start, end) ?? []) as Decoration[])
    .slice()
    .sort((a, b) => a.from - b.from);
}

/** Opens the popover over a hovered grammar underline, hiding it on a short
 *  delay so the pointer can travel into the popover. */
export function useGrammarPopover(
  run: EditorRunner,
  getStaleMessage: () => string,
) {
  const [popover, setPopover] = useState<GrammarPopoverInfo | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const onMouseOver = useCallback(
    (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest?.(
        ".grammar-issue",
      ) as HTMLElement | null;
      if (!target) return;
      if (hideTimer.current) clearTimeout(hideTimer.current);

      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const pos = view.posAtDOM(target, 0);
        const found = grammarKey.getState(view.state)?.find(pos, pos + 1) ?? [];
        const deco = found[0];
        if (!deco) return;
        const rect = target.getBoundingClientRect();
        setApplyError(null);
        setPopover(
          popoverFor(
            deco,
            rect.left,
            rect.bottom + 6,
            siblingsOf(view.state, deco),
            view.state,
          ),
        );
      });
    },
    [run],
  );

  const onMouseOut = useCallback((e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest?.(".grammar-issue");
    if (!target) return;
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.closest?.(".grammar-popover")) return;
    hideTimer.current = setTimeout(() => setPopover(null), 150);
  }, []);

  // The caret entering an underline opens the popover; leaving closes one
  // the caret opened, never one the pointer is using.
  const openedByCaret = useRef(false);
  const onCaretMove = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { selection } = view.state;
      const deco = selection.empty
        ? grammarIssueAt(view.state, selection.from)
        : null;
      if (!deco) {
        if (openedByCaret.current) {
          openedByCaret.current = false;
          setPopover(null);
        }
        return;
      }
      const coords = view.coordsAtPos(deco.from);
      openedByCaret.current = true;
      setApplyError(null);
      setPopover((prev) =>
        prev?.from === deco.from && prev.to === deco.to
          ? prev
          : popoverFor(
              deco,
              coords.left,
              coords.bottom + 6,
              siblingsOf(view.state, deco),
              view.state,
            ),
      );
    });
  }, [run]);

  const ignore = useCallback(() => {
    if (!popover) return;
    run((ctx) =>
      ignoreGrammarIssue(
        ctx.get(editorViewCtx),
        popover.original,
        popover.suggestion,
      ),
    );
    setPopover(null);
  }, [popover, run]);

  /** To the paragraph's previous or next underline (the card's ‹ ›). */
  const step = useCallback(
    (delta: 1 | -1) => {
      if (!popover) return;
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const here = grammarIssueAt(view.state, popover.from);
        if (!here) return;
        const all = siblingsOf(view.state, here);
        const i = all.findIndex((d) => d.from === here.from);
        const next = all[(i + delta + all.length) % all.length];
        if (!next) return;
        const coords = view.coordsAtPos(next.from);
        setApplyError(null);
        setPopover(
          popoverFor(next, coords.left, coords.bottom + 6, all, view.state),
        );
      });
    },
    [popover, run],
  );

  const cancelHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  const hide = useCallback(() => {
    setPopover(null);
    setApplyError(null);
  }, []);

  /** Whether the fix went in (the phone's sheet, closed by then, reports a
   *  stale one itself). */
  const applyFix = useCallback((): boolean => {
    if (!popover) return false;
    const { suggestion, original } = popover;
    let applied = false;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;

      // The hover-time range goes stale on any edit. A surviving live
      // decoration is trustworthy: the plugin drops ones whose text changed.
      const live = (grammarKey.getState(state)?.find() ?? []).find(
        (deco: Decoration) => {
          const spec = deco.spec as GrammarDecorationSpec;
          return spec.original === original && spec.suggestion === suggestion;
        },
      );
      let range = live ? { from: live.from, to: live.to } : null;

      // Else the text itself, if it occurs exactly once.
      if (!range && original) range = findUniqueTextRange(state.doc, original);

      // Last line of defense against replacing the wrong text: the range
      // must still say exactly what the model was fixing.
      if (
        !range ||
        (original !== undefined &&
          state.doc.textBetween(range.from, range.to) !== original)
      ) {
        return;
      }
      view.dispatch(state.tr.insertText(suggestion, range.from, range.to));
      view.focus();
      applied = true;
    });
    if (applied) {
      setPopover(null);
      setApplyError(null);
    } else {
      // A silently dead Apply button would read as broken.
      setApplyError(getStaleMessage());
    }
    return applied;
  }, [popover, run, getStaleMessage]);

  return {
    popover,
    applyError,
    onMouseOver,
    onMouseOut,
    cancelHide,
    hide,
    applyFix,
    onCaretMove,
    ignore,
    step,
  };
}
