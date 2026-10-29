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
import { useActiveProvider, useWebSearchStatus } from "../provider-catalog";
import type { AgentMode } from "../../prefs/SettingsContext";
import { initialMode, rememberMode } from "./last-mode";
import { deepThinkingOn, useCanThinkDeeper } from "./deep-thinking";
import { useLatest } from "../../utils/hooks/useLatest";
import type {
  ChatComposerHandle,
  ChatComposerProps,
  SelectionChipHandlers,
} from "./composer-types";
import { currentStrings } from "../../i18n/current";
import { explainError } from "../../utils/error-explain";

/** The composer's state, one hook per concern. */

/** What is typed, and the picker over it. The input grows with its content
 *  up to the CSS max-height, then scrolls. `handle` lets the chat give back
 *  queued messages (`restore`). */
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
    // scrollHeight is an integer, so the height can land a hair short of the
    // line box and WebKit then clips the caret (worst with CJK). One
    // correction pass fits whatever the font does.
    if (el.scrollHeight > el.clientHeight) {
      needed += el.scrollHeight - el.clientHeight;
      el.style.height = `${needed}px`;
    }
    // Scrolling only once the content outgrows the box, or an empty input
    // draws scrollbars.
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

/** The files staged to go with the message, and why one couldn't be, shown
 *  rather than swallowed. Vision support is derived here, the only place an
 *  image is staged, so no caller can forget it. */
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
      setAttachError(explainError(err, currentStrings()));
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
  onModeChange,
}: {
  tourMode: AgentMode | null;
  carryMode: boolean;
  defaultMode: AgentMode;
  onModeChange: ChatComposerProps["onModeChange"];
}) {
  const [mode, setModeState] = useState<AgentMode>(
    () => tourMode ?? (carryMode ? initialMode(defaultMode) : defaultMode),
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

/** The request's options: the web, and how hard the model thinks. With search
 *  on but nothing to search with, the button says so (`searchUnavailable`).
 *  Deep shows only where it changes something; Quick Ask always asks fast. */
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
 * The selection riding along as context, droppable with a click. Dropping
 * remembers that text, not a flag, so a new selection brings the chip back.
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
 *  (`open`), and again for another document or project. */
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
