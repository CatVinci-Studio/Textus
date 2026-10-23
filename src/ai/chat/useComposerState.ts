import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import type { ChatAttachment, ThinkingLevel } from "../types";
import { ai } from "../../platform/ipc";
import { errorText } from "../../utils/error-text";
import { useActiveProvider, useWebSearchStatus } from "../provider-catalog";
import type { AgentMode } from "../../settings/SettingsContext";
import { fitMode, initialMode, rememberMode } from "./last-mode";
import { deepThinkingOn, useCanThinkDeeper } from "./deep-thinking";
import { useLatest } from "../../utils/hooks/useLatest";
import type {
  ChatComposerHandle,
  ChatComposerProps,
  SelectionChipHandlers,
} from "./composer-types";

/**
 * The composer's state, a concern each (ChatComposer.tsx): what is typed
 * and the picker over it, the attachments, the mode, the request's
 * options, the selection riding along, and the project files a "@" lists.
 */

/** What is typed, and the picker over it. The input grows with its
 *  content (Shift+Enter newlines) up to the CSS max-height, then scrolls -
 *  a fixed single row just scrolled horizontally out of view. `handle`
 *  lets the chat give back what was waiting in the queue (`restore`). */
export function useComposerInput(handle?: Ref<ChatComposerHandle | null>) {
  const [input, setInput] = useState("");
  const [pickerIndex, setPickerIndex] = useState(0);
  // Escape closes a picker for the input as it stands; typing reopens it.
  const [dismissedInput, setDismissedInput] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(
    handle,
    () => ({
      restore: (text: string) => {
        setInput((now) => (now.trim() ? `${text}\n\n${now}` : text));
        inputRef.current?.focus();
      },
    }),
    [],
  );

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    let needed = el.scrollHeight;
    el.style.height = `${needed}px`;
    // scrollHeight is an integer, so the height just written can land a
    // fraction of a pixel short of the line box it was measured from -
    // WebKit then treats the textarea as scrolled by that hair, which clips
    // the caret (most visible with CJK text, whose glyph box fills the line
    // completely). One correction pass, and it fits whatever the font does.
    if (el.scrollHeight > el.clientHeight) {
      needed += el.scrollHeight - el.clientHeight;
      el.style.height = `${needed}px`;
    }
    // Scrolling is enabled only once the content genuinely outgrows the box;
    // leaving it permanently on is what drew scrollbars around an EMPTY input.
    const max = parseFloat(getComputedStyle(el).maxHeight);
    el.style.overflowY = needed > max ? "auto" : "hidden";
  }, [input]);

  return {
    input,
    setInput,
    pickerIndex,
    setPickerIndex,
    dismissedInput,
    setDismissedInput,
    inputRef,
  };
}

/** The files staged to go with the message, and why one couldn't be
 *  ("this PDF has no text layer", "too large", ...). Shown, never
 *  swallowed: the previous version caught and discarded every failure, so
 *  picking a PDF - which could not work at all, the reader being
 *  read_to_string - looked exactly like a dead "+" button. Whether the
 *  provider reads pictures is derived here rather than passed in: this is
 *  the only place an image can be staged, so deriving it at the gate makes
 *  it impossible for a caller to forget - which is exactly what happened
 *  when it was a prop, leaving Quick Ask happy to attach an image to a
 *  provider that can't read one. */
export function useAttachments(noVisionMessage: string) {
  const supportsVision = useActiveProvider()?.supportsVision ?? true;
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);

  async function attachFile() {
    setAttachError(null);
    try {
      const file = await ai.pickAttachmentFile();
      // null means the picker was cancelled - not something to report.
      if (!file) return;
      if (file.kind === "image" && !supportsVision) {
        setAttachError(noVisionMessage);
        return;
      }
      setAttachments((prev) => [...prev, file]);
    } catch (err) {
      setAttachError(errorText(err));
    }
  }

  return {
    attachments,
    setAttachments,
    attachError,
    setAttachError,
    attachFile,
  };
}

/** The mode the message goes in: the tour's while it runs, else the one
 *  carried from last time where the composer carries it, reported to
 *  `onModeChange` as it changes. */
export function useComposerMode({
  tourMode,
  carryMode,
  defaultMode,
  offeredModes,
  onModeChange,
}: {
  tourMode: AgentMode | null;
  carryMode: boolean;
  defaultMode: AgentMode;
  offeredModes: readonly AgentMode[];
  onModeChange: ChatComposerProps["onModeChange"];
}) {
  const [mode, setModeState] = useState<AgentMode>(
    () =>
      tourMode ??
      fitMode(carryMode ? initialMode(defaultMode) : defaultMode, offeredModes),
  );
  useEffect(() => {
    if (tourMode) setModeState(tourMode);
  }, [tourMode]);
  const onModeChangeRef = useLatest(onModeChange);
  useEffect(() => onModeChangeRef.current?.(mode), [mode, onModeChangeRef]);
  const setMode = (next: AgentMode) => {
    setModeState(next);
    if (carryMode) rememberMode(next, defaultMode);
  };
  return { mode, setMode };
}

/** The request's options: the web, and how hard the model thinks. With
 *  search on but nothing to search with - a model that can't search by
 *  itself and no search service set up - the button says so
 *  (`searchUnavailable`), rather than the request quietly going out
 *  without the web. Deep is shown only where it changes something: a model
 *  that doesn't think, or thinks one fixed way, has no button - and no
 *  Deep, even if it was left on for another model. Quick Ask (`compact`)
 *  always asks fast. */
export function useRequestOptions(defaultWebSearch: boolean, compact: boolean) {
  const searchStatus = useWebSearchStatus();
  const searchUnavailable =
    !!searchStatus && !searchStatus.native && !searchStatus.service;
  const [webSearch, setWebSearch] = useState(defaultWebSearch);
  const [deepThinking, setDeepThinking] = useState(deepThinkingOn);
  const canThinkDeeper = useCanThinkDeeper(!compact);
  const thinking: ThinkingLevel = compact
    ? "fast"
    : deepThinking && canThinkDeeper
      ? "deep"
      : "auto";
  return {
    searchUnavailable,
    webSearch,
    setWebSearch,
    deepThinking,
    setDeepThinking,
    canThinkDeeper,
    thinking,
  };
}

/**
 * The selection riding along as context. It does by default, but a
 * question about the document as a whole shouldn't be forced to carry
 * whatever happened to be highlighted - dropping it is a click, not a
 * re-selection.
 *
 * Dropping applies to THAT selection, not to the chat forever: in the
 * detached window the user goes on highlighting new passages, and each one
 * is a fresh request to talk about it. Remembering which text was dismissed
 * (rather than a bare flag) gets both halves right - the chip stays gone
 * while that selection is current, and a genuinely new selection brings it
 * back without the user having to reopen anything.
 *
 * Whether the chip shows, and is pointed at, goes to `selectionChip`; and,
 * gone with the composer (the panel closed, another tab came forward), that
 * it shows no more.
 */
export function useSelectionChip(
  selectedText: string | null,
  selectionChip: SelectionChipHandlers | undefined,
) {
  const [droppedSelection, setDroppedSelection] = useState<string | null>(null);
  const selectionDropped =
    droppedSelection !== null && droppedSelection === selectedText;
  const showSelection = !!selectedText && !selectionDropped;
  const [chipHot, setChipHot] = useState(false);
  const chipHandlers = useLatest(selectionChip);
  const shown = showSelection;
  const hot = showSelection && chipHot;
  // Reported by value, and again for each new selection; the handlers are
  // read through a ref.
  useEffect(() => {
    chipHandlers.current?.onChange({ shown, hot });
  }, [shown, hot, selectedText, chipHandlers]);
  useEffect(
    () => () => chipHandlers.current?.onChange({ shown: false, hot: false }),
    [chipHandlers],
  );
  return { selectionDropped, setDroppedSelection, showSelection, setChipHot };
}

/** The project's files for the @-mention picker: fetched on the first "@"
 *  (`open`), not on mount - most messages never mention a file - and again
 *  for another document or project. */
export function useProjectFiles(
  open: boolean,
  docPath: string | null,
  workspaceRoot: string | null,
) {
  const [projectFiles, setProjectFiles] = useState<string[] | null>(null);
  useEffect(() => {
    setProjectFiles(null);
  }, [docPath, workspaceRoot]);
  useEffect(() => {
    if (!open || projectFiles !== null) return;
    let cancelled = false;
    ai.listProjectFiles(docPath, workspaceRoot)
      .then((files) => !cancelled && setProjectFiles(files ?? []))
      .catch(() => !cancelled && setProjectFiles([]));
    return () => {
      cancelled = true;
    };
  }, [open, projectFiles, docPath, workspaceRoot]);
  return projectFiles;
}
