import { useCallback, useEffect, useRef, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { compileQuery, findReplaceKey } from "./find-replace-plugin";
import { scrollBehavior } from "../../ui/motion";
import { unfoldRange } from "../html/details-fold";
import type { EditorRunner } from "../useEditorRunner";

export interface FindReplaceStatus {
  matchCount: number;
  activeIndex: number;
  error: boolean;
}

const IDLE_STATUS: FindReplaceStatus = {
  matchCount: 0,
  activeIndex: -1,
  error: false,
};

/** The bar-facing view of the plugin's state, read back after a dispatch. */
function readStatus(view: EditorView): FindReplaceStatus {
  const s = findReplaceKey.getState(view.state);
  return s
    ? {
        matchCount: s.matches.length,
        activeIndex: s.activeIndex,
        error: s.error,
      }
    : IDLE_STATUS;
}

function scrollToActive(view: EditorView, behavior = scrollBehavior()) {
  const s = findReplaceKey.getState(view.state);
  const match = s?.matches[s.activeIndex];
  if (!match) return;
  // A match in a folded <details> opens it.
  unfoldRange(view, match.from, match.to);
  try {
    const dom = view.domAtPos(match.from).node;
    const el = dom instanceof Element ? dom : dom.parentElement;
    el?.scrollIntoView({ block: "center", behavior });
  } catch {
    // Not representable in the DOM right now.
  }
}

/** Owns the find & replace bar's open state and drives the plugin. */
export function useFindReplace(run: EditorRunner) {
  const [open, setOpenState] = useState(false);
  // The window-event listeners are re-attached after each render, so a quick
  // second Find event can reach stale callbacks; reading `open` there closed
  // the reopening bar.
  const openRef = useRef(false);
  const setOpen = useCallback((value: boolean) => {
    openRef.current = value;
    setOpenState(value);
  }, []);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [status, setStatus] = useState<FindReplaceStatus>(IDLE_STATUS);

  // Any change to the search inputs while open re-runs the search, including
  // a kept query when the bar reopens.
  useEffect(() => {
    if (!open) return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(
        view.state.tr.setMeta(findReplaceKey, {
          type: "search",
          query,
          caseSensitive,
          useRegex,
        }),
      );
      setStatus(readStatus(view));
      // Instant: a smooth scroll per keystroke would chase its own tail.
      if (query) scrollToActive(view, "auto");
    });
  }, [open, query, caseSensitive, useRegex, run]);

  const toggleCaseSensitive = useCallback(
    () => setCaseSensitive((v) => !v),
    [],
  );
  const toggleUseRegex = useCallback(() => setUseRegex((v) => !v), []);

  const step = useCallback(
    (delta: 1 | -1) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const s = findReplaceKey.getState(view.state);
        if (!s || s.matches.length === 0) return;
        const index =
          (s.activeIndex + delta + s.matches.length) % s.matches.length;
        view.dispatch(
          view.state.tr.setMeta(findReplaceKey, { type: "setActive", index }),
        );
        setStatus(readStatus(view));
        scrollToActive(view);
      });
    },
    [run],
  );

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  /** Regex mode re-applies the query's capture groups to the match's text;
   *  plain mode is a literal swap. */
  const makeReplacer = useCallback((): ((matchText: string) => string) => {
    if (!useRegex) return () => replacement;
    const regex = compileQuery(query, caseSensitive, true, false);
    return regex
      ? (text) => text.replace(regex, replacement)
      : () => replacement;
  }, [useRegex, query, caseSensitive, replacement]);

  const replaceOne = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const s = findReplaceKey.getState(view.state);
      const match = s?.matches[s.activeIndex];
      if (!match) return;
      view.dispatch(
        view.state.tr.insertText(
          makeReplacer()(match.text),
          match.from,
          match.to,
        ),
      );
      view.focus();
      setStatus(readStatus(view));
    });
  }, [run, makeReplacer]);

  const replaceAll = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const s = findReplaceKey.getState(view.state);
      if (!s || s.matches.length === 0) return;
      const replace = makeReplacer();
      let tr = view.state.tr;
      // Reverse order, so a replacement never shifts matches still to come.
      for (let i = s.matches.length - 1; i >= 0; i--) {
        const match = s.matches[i];
        tr = tr.insertText(replace(match.text), match.from, match.to);
      }
      view.dispatch(tr);
      view.focus();
      setStatus(readStatus(view));
    });
  }, [run, makeReplacer]);

  const close = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta(findReplaceKey, { type: "clear" }));
      view.focus();
    });
    setOpen(false);
    setStatus(IDLE_STATUS);
  }, [run, setOpen]);

  /** Closes the bar without focusing the document: something else is taking
   *  the screen, and focus would bring the iPhone keyboard up under it. */
  const dismiss = useCallback(() => {
    if (!openRef.current) return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta(findReplaceKey, { type: "clear" }));
    });
    setOpen(false);
    setStatus(IDLE_STATUS);
  }, [run, setOpen]);

  const toggle = useCallback(() => {
    if (openRef.current) close();
    else setOpen(true);
  }, [close, setOpen]);

  // Escape closes the bar even once focus has moved to the editor.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Escape mid-composition cancels the IME candidate, not the bar.
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  return {
    open,
    query,
    replacement,
    caseSensitive,
    useRegex,
    status,
    setQuery,
    setReplacement,
    toggleCaseSensitive,
    toggleUseRegex,
    next,
    prev,
    replaceOne,
    replaceAll,
    close,
    dismiss,
    toggle,
  };
}

export type FindReplace = ReturnType<typeof useFindReplace>;
