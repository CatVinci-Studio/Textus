import { CJK_SCRIPT } from "../../utils/cjk";
import { keepWhile } from "../../engine/controls/scroll-hold";
import { TextSelection } from "@milkdown/kit/prose/state";
import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
} from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Decoration, EditorView } from "@milkdown/kit/prose/view";
import {
  issueAt,
  issueSource,
  issuesIn,
  type IssueSpec,
} from "../../editor/issues/issue-sources";
import { grammarKind } from "./grammar-kind";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { GrammarPopoverInfo } from "./GrammarPopover";
import type { EditorRunner } from "../../editor/useEditorRunner";
import { markChangeSource } from "../../editor/change-source";

/** The pointer leaving an underline may be on its way to the card: it
 *  stays this long. */
const HOVER_GRACE_MS = 150;

/** The popover for one underline, placed at (x, y), with where it stands
 *  among the paragraph's other underlines. */
function popoverFor(
  deco: Decoration,
  x: number,
  y: number,
  siblings: Decoration[] = [deco],
  state?: EditorState,
): GrammarPopoverInfo {
  const spec = deco.spec as IssueSpec;
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
    kind: grammarKind(spec.original, spec.suggestion ?? "", spec.rule),
    label: spec.label,
    source: spec.source,
    otherFix: spec.fix && { label: spec.fix.label },
    shownOriginal: shown?.original,
    shownSuggestion: shown?.suggestion,
    index: Math.max(0, index),
    count: siblings.length,
  };
}

/** A one-character CJK fix (必 -> 毕 for 必竟) shown with its neighbour on
 *  the card, while Apply still changes only the one. */
function withContext(
  state: EditorState,
  deco: Decoration,
  spec: IssueSpec,
): { original: string; suggestion: string } | null {
  const original = spec.original ?? "";
  if (spec.suggestion === undefined) return null;
  if ([...original].length !== 1 || !CJK_SCRIPT.test(original)) return null;
  const $pos = state.doc.resolve(deco.from);
  const end = $pos.end();
  const start = $pos.start();
  const next = deco.to < end ? state.doc.textBetween(deco.to, deco.to + 1) : "";
  if (CJK_SCRIPT.test(next))
    return { original: original + next, suggestion: spec.suggestion + next };
  const prev =
    deco.from > start ? state.doc.textBetween(deco.from - 1, deco.from) : "";
  if (CJK_SCRIPT.test(prev))
    return { original: prev + original, suggestion: prev + spec.suggestion };
  return null;
}

/** The underlines in the same paragraph as `deco`, in order. */
function siblingsOf(state: EditorState, deco: Decoration): Decoration[] {
  const $pos = state.doc.resolve(deco.from);
  const start = $pos.start();
  const end = $pos.end();
  return issuesIn(state, start, end);
}

/** The card shown while the pointer is on an underline, and a moment after
 *  it leaves, unless it moved onto the card. */
function usePointerHover(
  run: EditorRunner,
  setPopover: Dispatch<SetStateAction<GrammarPopoverInfo | null>>,
  setApplyError: (error: string | null) => void,
) {
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
        const deco = issuesIn(view.state, pos, pos + 1)[0];
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
    [run, setPopover, setApplyError],
  );

  const onMouseOut = useCallback(
    (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest?.(".grammar-issue");
      if (!target) return;
      const related = e.relatedTarget as HTMLElement | null;
      if (related?.closest?.(".grammar-popover")) return;
      hideTimer.current = setTimeout(() => setPopover(null), HOVER_GRACE_MS);
    },
    [setPopover],
  );

  const cancelHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  return { onMouseOver, onMouseOut, cancelHide };
}

/** The caret entering an underline opens the card; leaving closes one the
 *  caret opened, never one the pointer is using. */
function useCaretOpens(
  run: EditorRunner,
  setPopover: Dispatch<SetStateAction<GrammarPopoverInfo | null>>,
  setApplyError: (error: string | null) => void,
) {
  const openedByCaret = useRef(false);
  const onCaretMove = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { selection } = view.state;
      const deco = selection.empty ? issueAt(view.state, selection.from) : null;
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
  }, [run, setPopover, setApplyError]);

  return onCaretMove;
}

/** Opens the popover over a hovered grammar underline, hiding it on a short
 *  delay so the pointer can travel into the popover. */
export function useGrammarPopover(
  run: EditorRunner,
  getStaleMessage: () => string,
) {
  const [popover, setPopover] = useState<GrammarPopoverInfo | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const { onMouseOver, onMouseOut, cancelHide } = usePointerHover(
    run,
    setPopover,
    setApplyError,
  );
  const onCaretMove = useCaretOpens(run, setPopover, setApplyError);

  const ignore = useCallback(() => {
    if (!popover) return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const here = issueAt(view.state, popover.from);
      const spec = here?.spec as IssueSpec | undefined;
      if (spec) issueSource(spec)?.ignore(view, spec);
    });
    setPopover(null);
  }, [popover, run]);

  /** To the paragraph's previous or next underline (the card's ‹ ›). */
  const step = useCallback(
    (delta: 1 | -1) => {
      if (!popover) return;
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const here = issueAt(view.state, popover.from);
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
    if (popover.otherFix) {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const here = issueAt(view.state, popover.from);
        const spec = here?.spec as IssueSpec | undefined;
        applied = !!spec?.fix?.apply(view);
        if (applied) focusInPlace(view);
      });
      if (applied) setPopover(null);
      else setApplyError(getStaleMessage());
      return applied;
    }
    if (suggestion === undefined) return false;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;

      // The hover-time range goes stale on any edit. A surviving live
      // decoration is trustworthy: the plugin drops ones whose text changed.
      // The same slip may be written twice: the one nearest the card's.
      const live = issuesIn(state)
        .filter((deco: Decoration) => {
          const spec = deco.spec as IssueSpec;
          return (
            spec.source === popover.source &&
            spec.original === original &&
            spec.suggestion === suggestion
          );
        })
        .sort(
          (a: Decoration, b: Decoration) =>
            Math.abs(a.from - popover.from) - Math.abs(b.from - popover.from),
        )[0];
      // Only the underline itself: with it gone the words changed, and the
      // same words elsewhere (or inside the new ones) aren't the slip.
      const range = live ? { from: live.from, to: live.to } : null;

      // Last line of defense against replacing the wrong text: the range
      // must still say exactly what the model was fixing.
      if (
        !range ||
        (original !== undefined &&
          state.doc.textBetween(range.from, range.to) !== original)
      ) {
        return;
      }
      // The caret after the fixed words, where the reader is, and the page
      // kept still as the editor takes the focus back.
      const tr = state.tr.insertText(suggestion, range.from, range.to);
      tr.setSelection(
        TextSelection.create(tr.doc, range.from + suggestion.length),
      );
      const source = live && issueSource(live.spec as IssueSpec);
      view.dispatch(markChangeSource(tr, source?.changeSource ?? "ai"));
      focusInPlace(view);
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

/** The editor focused from a control outside it (a card's Apply) with the
 *  page left where the reader has it: WebKit, taking the focus back, first
 *  puts back its own selection from before and scrolls to that, however
 *  far it is. */
function focusInPlace(view: EditorView): void {
  keepWhile(view.dom.closest<HTMLElement>(".editor-scroll"), () =>
    view.focus(),
  );
}
