import { useCallback, useEffect, useRef, useState } from "react";
import {
  expandReplacement,
  type FindReplaceMatch,
  type FindState,
} from "./find-query";
import type { FindBackend } from "./find-backend";
import { scrollBehavior } from "../../engine/motion/motion";
import { isImeKeydown } from "../../utils/ime";

interface FindReplaceStatus {
  matchCount: number;
  activeIndex: number;
  error: boolean;
}

const IDLE_STATUS: FindReplaceStatus = {
  matchCount: 0,
  activeIndex: -1,
  error: false,
};

const statusOf = (s: FindState): FindReplaceStatus => ({
  matchCount: s.matches.length,
  activeIndex: s.activeIndex,
  error: s.error,
});

const activeOf = (s: FindState) => s.matches[s.activeIndex];

/** Owns the find & replace bar's open state and drives its editor's search,
 *  the rich document's or its source's (`editor`). */
export function useFindReplace(editor: FindBackend) {
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
  const [replaceOpen, setReplaceOpen] = useState(false);
  // Bumped when Find is asked for again with the bar open: the bar takes the
  // focus back and selects its query.
  const [focusRequest, setFocusRequest] = useState(0);
  // Stepped through matches since opening: closing leaves the active one
  // selected, as other editors do.
  const stepped = useRef(false);

  // Any change to the search inputs while open re-runs the search, including
  // a kept query when the bar reopens.
  useEffect(() => {
    if (!open) return;
    const found = editor.apply({
      type: "search",
      query,
      caseSensitive,
      useRegex,
    });
    setStatus(statusOf(found));
    // Instant: a smooth scroll per keystroke would chase its own tail.
    const active = activeOf(found);
    if (query && active) editor.reveal(active, false);
  }, [open, query, caseSensitive, useRegex, editor]);

  const toggleCaseSensitive = useCallback(
    () => setCaseSensitive((v) => !v),
    [],
  );
  const toggleUseRegex = useCallback(() => setUseRegex((v) => !v), []);

  const step = useCallback(
    (delta: 1 | -1) => {
      const s = editor.state();
      if (s.matches.length === 0) return;
      const index =
        (s.activeIndex + delta + s.matches.length) % s.matches.length;
      const found = editor.apply({ type: "setActive", index });
      stepped.current = true;
      setStatus(statusOf(found));
      const active = activeOf(found);
      if (active) editor.reveal(active, scrollBehavior() === "smooth");
    },
    [editor],
  );

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  /** Regex mode writes out what each match captured where it was found;
   *  plain mode is a literal swap. */
  const makeReplacer = useCallback(
    (): ((match: FindReplaceMatch) => string) =>
      useRegex
        ? (match) => expandReplacement(replacement, match)
        : () => replacement,
    [useRegex, replacement],
  );

  /** `matches` replaced, as one undo step. */
  const replaceMatches = useCallback(
    (matches: FindReplaceMatch[]) => {
      if (!matches.length) return;
      const replace = makeReplacer();
      editor.replace(
        matches.map((m) => ({ from: m.from, to: m.to, text: replace(m) })),
      );
      setStatus(statusOf(editor.state()));
    },
    [editor, makeReplacer],
  );
  const replaceOne = useCallback(() => {
    const match = activeOf(editor.state());
    if (match) replaceMatches([match]);
  }, [editor, replaceMatches]);
  const replaceAll = useCallback(
    () => replaceMatches(editor.state().matches),
    [editor, replaceMatches],
  );

  const close = useCallback(() => {
    const match = stepped.current ? activeOf(editor.state()) : undefined;
    editor.clear(match ?? null, true);
    setOpen(false);
    setStatus(IDLE_STATUS);
  }, [editor, setOpen]);

  /** Closes the bar without focusing the document: something else is taking
   *  the screen, and focus would bring the iPhone keyboard up under it. */
  const dismiss = useCallback(() => {
    if (!openRef.current) return;
    editor.clear(null, false);
    setOpen(false);
    setStatus(IDLE_STATUS);
  }, [editor, setOpen]);

  /** Find: opens the bar, or takes the focus back to it. Words selected on
   *  one line become the query. */
  const show = useCallback(() => {
    const words = editor.selectedText();
    if (words.trim() && !words.includes("\n") && words.length <= 200)
      setQuery(words);
    if (openRef.current) setFocusRequest((n) => n + 1);
    else {
      stepped.current = false;
      setOpen(true);
    }
  }, [editor, setOpen]);

  /** Replace…: the bar with its replace row open. */
  const showReplace = useCallback(() => {
    setReplaceOpen(true);
    show();
  }, [show]);

  /** Find Next: the next match while the bar is open; else the bar, at the
   *  match after the caret of what it last looked for. */
  const findNext = useCallback(() => {
    if (openRef.current && query) step(1);
    else show();
  }, [query, show, step]);

  // Escape closes the bar from it or from its document, once focus has
  // moved there; one pressed in a dialog, a menu or another island is
  // theirs.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Escape mid-composition cancels the IME candidate, not the bar.
      if (isImeKeydown(e) || e.key !== "Escape") return;
      const at = e.target instanceof Element ? e.target : null;
      const ours =
        !!at && (!!at.closest(".find-replace-bar") || editor.contains(at));
      if (ours) close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close, editor]);

  return {
    open,
    query,
    replacement,
    caseSensitive,
    useRegex,
    status,
    focusRequest,
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
    show,
    showReplace,
    findNext,
    replaceOpen,
    setReplaceOpen,
  };
}

export type FindReplace = ReturnType<typeof useFindReplace>;
