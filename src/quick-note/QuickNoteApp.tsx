import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettings } from "../settings/SettingsContext";
import { quickNote, session, type QuickNoteTarget } from "../platform/ipc";
import { modIsMeta } from "../platform/os";
import { appDrawsWindowFrame } from "../platform/window-chrome";
import { AppDialogHost, showConfirm } from "../ui/app-dialog";
import { WindowCloseIcon } from "../ui/icons";
import { flushPendingWrites } from "../storage/pending-writes";
import { comboFromEvent } from "../utils/shortcuts";
import { errorText } from "../utils/error-text";
import { listenToThisWindow, unlistenAll } from "../utils/tauri-events";
import { useLatest } from "../utils/hooks/useLatest";
import { QuickNoteEditor, type QuickNoteEditorHandle } from "./QuickNoteEditor";
import { savesAndCloses } from "./keys";
import { chooseStart, localStamp, type QuickNoteStart } from "./start";
// This window renders no App, so it brings the tokens, palettes and dialog
// look itself, as the detached chat window does.
import "../ui/base.css";
import "../ui/app-dialog.css";
import "../ui/window-caption.css";
import "./quick-note.css";

/** Whether something nearer the caret than the window has Escape of its
 *  own: a menu, a dialog, a list, or a field of the editor's (a code
 *  block's language, a math source). */
function popoverOpen(target: EventTarget | null): boolean {
  if (
    document.querySelector(
      '[data-floating-menu], [role="dialog"], [role="menu"], [role="listbox"]',
    )
  )
    return true;
  return (
    target instanceof HTMLElement &&
    target.matches(
      "input, textarea, select, [contenteditable] [contenteditable]",
    )
  );
}

/** How long typing rests before the draft is written (crash insurance). */
const DRAFT_DELAY_MS = 400;
/** How long the header's file name waits for typing to rest. */
const NAME_DELAY_MS = 150;
const NOTICE_MS = 4000;

/**
 * The Quick Note window (src-tauri/src/commands/quick_note/): one note,
 * saved as it closes. Escape, ⌘/Ctrl+Enter, ⌘/Ctrl+S, ⌘/Ctrl+W, the close
 * button and quitting all save and close; an empty note closes without
 * writing anything. While the user types, a draft is kept in the app's
 * data folder and restored next time if the window never got to save.
 */
export function QuickNoteApp() {
  const { t, settings } = useSettings();
  const [start, setStart] = useState<QuickNoteStart | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasText, setHasText] = useState(false);
  const editor = useRef<QuickNoteEditorHandle | null>(null);
  const textRef = useRef("");
  const targetRef = useRef<QuickNoteTarget | null>(null);
  const busy = useRef(false);
  const composing = useRef(false);
  const draftTimer = useRef<number | undefined>(undefined);
  // The draft write in flight: a save or a discard waits for it, or a
  // draft landing after the note was saved would come back next time.
  const draftWrite = useRef<Promise<unknown>>(Promise.resolve());
  const nameTimer = useRef<number | undefined>(undefined);
  const settingsRef = useLatest(settings);
  const tRef = useLatest(t);

  // What to open with: a draft left behind, the note just saved, or nothing.
  useEffect(() => {
    let alive = true;
    void quickNote
      .session()
      .catch(() => ({ draft: null, last: null }))
      .then((s) => {
        if (!alive) return;
        const { quickNoteContinueMinutes, quickNotePerDay } =
          settingsRef.current;
        const chosen = chooseStart(
          s,
          Date.now(),
          quickNoteContinueMinutes,
          quickNotePerDay,
        );
        textRef.current = chosen.kind === "blank" ? "" : chosen.text;
        targetRef.current = chosen.kind === "blank" ? null : chosen.target;
        setHasText(!!textRef.current.trim());
        setStart(chosen);
        if (chosen.kind === "draft")
          setNotice(tRef.current.quickNoteDraftRestored);
        if (chosen.kind === "continue")
          setNotice(tRef.current.quickNoteContinuing);
      });
    return () => {
      alive = false;
    };
  }, [settingsRef, tRef]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    void getCurrentWindow()
      .setTitle(t.quickNoteTitle)
      .catch(() => {});
  }, [t.quickNoteTitle]);

  const refreshName = useCallback(() => {
    void quickNote
      .previewName(textRef.current, targetRef.current, localStamp(new Date()))
      .then(setName)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (start) refreshName();
  }, [start, refreshName, settings.quickNotePerDay, settings.quickNoteFolder]);

  const onChange = useCallback(
    (markdown: string) => {
      textRef.current = markdown;
      setHasText(!!markdown.trim());
      window.clearTimeout(draftTimer.current);
      draftTimer.current = window.setTimeout(() => {
        draftWrite.current = quickNote
          .saveDraft(textRef.current, targetRef.current)
          .catch(() => {});
      }, DRAFT_DELAY_MS);
      window.clearTimeout(nameTimer.current);
      nameTimer.current = window.setTimeout(refreshName, NAME_DELAY_MS);
    },
    [refreshName],
  );

  const currentText = () => editor.current?.markdown() ?? textRef.current;

  /** Saves the note (an empty one is not written) and closes the window.
   *  Resolves false when the save failed and the window stays. */
  const commit = useCallback(
    async (then: "close" | "open-in-textus" = "close"): Promise<boolean> => {
      if (busy.current) return true;
      busy.current = true;
      window.clearTimeout(draftTimer.current);
      const text = currentText();
      try {
        await draftWrite.current;
        // Nothing but whitespace: a note not taken. Nothing is written,
        // and a continued note stays as it was.
        const path = text.trim()
          ? await quickNote.commit(
              text,
              targetRef.current,
              localStamp(new Date()),
            )
          : await quickNote.discardDraft().then(() => null);
        await flushPendingWrites();
        if (then === "open-in-textus")
          await quickNote.openInEditor(path ?? targetRef.current?.path ?? null);
        else await quickNote.finish(true);
        return true;
      } catch (err) {
        busy.current = false;
        // A quit waiting on this window goes no further: the note is
        // still here, and so is its draft.
        void session.cancelQuit();
        setError(`${t.quickNoteSaveFailed} ${errorText(err)}`);
        return false;
      }
    },
    [t.quickNoteSaveFailed],
  );
  const commitRef = useLatest(commit);

  async function discard() {
    if (busy.current) return;
    if (
      currentText().trim() &&
      !(await showConfirm(t.quickNoteDiscardConfirm, {
        okLabel: t.quickNoteDiscard,
        cancelLabel: t.closePromptCancel,
        danger: true,
      }))
    )
      return;
    busy.current = true;
    window.clearTimeout(draftTimer.current);
    await draftWrite.current;
    await quickNote.discardDraft().catch(() => {});
    await quickNote.finish(true);
  }

  // The keys that save and close (keys.ts). Bubble phase, after the
  // editor and the find bar, which keeps its keys to itself.
  useEffect(() => {
    const onCompositionStart = () => {
      composing.current = true;
    };
    // WebKit can deliver the key that ended a composition after
    // compositionend; the flag outlives the event by a turn.
    const onCompositionEnd = () => {
      window.setTimeout(() => {
        composing.current = false;
      }, 0);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        settingsRef.current.shortcuts.findReplace &&
        comboFromEvent(e) === settingsRef.current.shortcuts.findReplace
      ) {
        e.preventDefault();
        editor.current?.toggleFind();
        return;
      }
      if (
        savesAndCloses(e, {
          composing: composing.current,
          findOpen: editor.current?.findOpen() ?? false,
          popoverOpen: popoverOpen(e.target),
          mac: modIsMeta(),
        })
      ) {
        e.preventDefault();
        void commitRef.current();
      }
    };
    window.addEventListener("compositionstart", onCompositionStart, true);
    window.addEventListener("compositionend", onCompositionEnd, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("compositionstart", onCompositionStart, true);
      window.removeEventListener("compositionend", onCompositionEnd, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsRef, commitRef]);

  // File > Save and Close Tab (⌘S/⌘W in the menu bar, the accelerators on
  // Windows) reach this window as menu events while it is in front -
  // menu.rs routes them here rather than to a document behind it. The
  // close button and quitting the app ask to close: the note is saved
  // first, and the window stays if that fails.
  useEffect(() => {
    const win = getCurrentWindow();
    return unlistenAll(
      listenToThisWindow("menu-save-file", () => void commitRef.current()),
      listenToThisWindow("menu-close-tab", () => void commitRef.current()),
      listenToThisWindow("menu-find-replace", () =>
        editor.current?.toggleFind(),
      ),
      win.onCloseRequested(async (event) => {
        event.preventDefault();
        await commitRef.current();
      }),
    );
  }, [commitRef]);

  const onReady = useCallback(() => {
    void quickNote.ready().catch(() => {});
  }, []);

  return (
    <div className="quick-note">
      <div className="quick-note-header" data-tauri-drag-region>
        <span
          className="quick-note-target"
          title={t.quickNoteKeysHint}
          data-tauri-drag-region
        >
          {name ? t.quickNoteHeader.replace("{name}", name) : t.quickNoteTitle}
        </span>
        <div className="quick-note-actions">
          {hasText && (
            <button type="button" onClick={() => void discard()}>
              {t.quickNoteDiscard}
            </button>
          )}
          <button
            type="button"
            onClick={() => void commitRef.current("open-in-textus")}
          >
            {t.quickNoteOpenInTextus}
          </button>
        </div>
        {appDrawsWindowFrame && (
          // Close only: minimised, a window with no taskbar entry would be
          // lost, and a pad has nothing to maximise into.
          <div className="window-caption">
            <button
              type="button"
              className="window-caption-button window-caption-close"
              aria-label={t.windowClose}
              title={t.windowClose}
              onClick={() => void getCurrentWindow().close()}
            >
              <WindowCloseIcon />
            </button>
          </div>
        )}
      </div>
      {(notice || error) && (
        <div
          className={`quick-note-notice${error ? " quick-note-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error ?? notice}
        </div>
      )}
      {start && (
        <QuickNoteEditor
          initialValue={start.kind === "blank" ? "" : start.text}
          settings={settings}
          t={t}
          onChange={onChange}
          onReady={onReady}
          onImage={() => setNotice(t.quickNoteNoImages)}
          handleRef={editor}
        />
      )}
      <AppDialogHost okLabel={t.dialogOk} />
    </div>
  );
}
