import { sourceFind } from "../find/cm-find";
import { useSourceFind } from "../find/useSourceFind";
import { useEffect, useRef } from "react";
import {
  Annotation,
  Compartment,
  EditorState,
  type StateEffect,
  Transaction,
  type Extension,
} from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  keymap,
} from "@codemirror/view";
import {
  history,
  historyField,
  historyKeymap,
  indentLess,
  redo,
  selectAll,
  standardKeymap,
  undo,
} from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { centerSourceCaret } from "./mode-caret";
import { sourceHighlighting } from "./source-highlight";
import { sourceEscapes } from "./source-escapes";
import {
  registerSourceView,
  unregisterSourceView,
  type SourceEdit,
} from "./source-view-registry";
import { SOURCE_EDIT_EVENT } from "../../utils/events";
import { followFormatMenu, formatSource } from "./source-format-events";
import { sourceKeys, sourceTab } from "./source-keys";
import { tellCopied } from "../../clipboard/copied";
import { leaveSource, sourceLeftBy } from "../tab-left";
import { registerTabEditor } from "../tab-editor";
import { mayTakeKeys } from "../take-keys";
import "./source-editor.css";
import { sharedEnds } from "../../utils/lcs";
import { registerZoomPane } from "../../engine/zoom/zoom-panes";
import { followOutlineJumps } from "./source-jumps";

/** A change the tab's markdown made, not the user. */
const outside = Annotation.define<boolean>();
/** The texts each editor's edits reported, not yet seen coming back. */
const sentBy = new WeakMap<EditorView, string[]>();
/** Typing reports its text after this pause, as the rich editor does. */
const REPORT_MS = 200;

/** What a copy or cut takes: the selected ranges, a line apart. */
function tellSelection(view: EditorView, cut: boolean) {
  const { state } = view;
  const text = state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => state.sliceDoc(range.from, range.to))
    .join(state.lineBreak);
  tellCopied(text, cut);
}

// Read-only refuses changes but stays focusable: the caret still moves,
// and the caret carried over from the rich view still lands.
const readOnlyOf = (readOnly: boolean): Extension =>
  EditorState.readOnly.of(readOnly);

export interface SourceEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  /** Typewriter mode: keep the caret's line in the middle. */
  typewriter: boolean;
  readOnly?: boolean;
  className?: string;
  /** Split view follows the source pane's scroll. */
  onScroll?: (scroller: HTMLElement) => void;
  /** Takes a paste before CodeMirror does: true when it is handled. A
   *  document's source passes one that writes a pasted picture's Markdown
   *  (see DocSourceEditor); the playground has no file to store one beside. */
  onPaste?: (event: ClipboardEvent, view: EditorView) => boolean;
  /** The tab it edits: a save first pulls in what was just typed. */
  tabId?: string;
  /** More of CodeMirror's, read once as it mounts: a document's source
   *  completes link paths (see DocSourceEditor). */
  extensions?: Extension[];
  /** A plain text file's language in place of Markdown's, read once: no
   *  Markdown help then (escapes, Bold and Italic, the Format menu). */
  syntax?: Extension;
}

/**
 * Editable Markdown source with syntax colours, shared by source mode, split
 * view and the web playground. A CodeMirror document rather than a textarea:
 * a textarea draws its whole value in one colour and has no DOM to style.
 */
export function SourceEditor({
  value,
  onChange,
  typewriter,
  readOnly = false,
  className = "",
  onScroll,
  onPaste,
  tabId,
  extensions: more = [],
  syntax,
}: SourceEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyRef = useRef<Compartment | null>(null);
  const latest = useRef({
    value,
    onChange,
    typewriter,
    readOnly,
    onScroll,
    tabId,
    more,
    syntax,
  });
  latest.current = {
    value,
    onChange,
    typewriter,
    readOnly,
    onScroll,
    tabId,
    more,
    syntax,
  };
  // The extension is built once; it reads the current handler through here.
  const pasteRef = useRef(onPaste);
  pasteRef.current = onPaste;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const compartment = new Compartment();
    readOnlyRef.current = compartment;
    // The text goes out a pause after typing: a copy of the whole document
    // and a window render per key was too much for a long one.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let touched = false;
    const report = () => {
      if (timer === null) return null;
      clearTimeout(timer);
      timer = null;
      const text = view.state.doc.toString();
      if (text === latest.current.value) return null;
      sentBy.set(view, [...(sentBy.get(view) ?? []), text]);
      latest.current.onChange(text);
      return text;
    };
    const plain = latest.current.syntax;
    const extensions: Extension[] = [
      // Source mode edits as plain text does, with colours: no line or
      // word highlights, multiple carets, auto-indent or code keys.
      history(),
      indentUnit.of("\t"),
      drawSelection(),
      dropCursor(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
        // Where the text starts: held as the pane changes width (carry.ts).
        "data-frame-column": "",
      }),
      // The plain-text keys only: no searchKeymap (Ctrl/Cmd+F is
      // Textus's own find bar). Tab indents as in a text editor; Escape
      // then Tab still moves the focus on. Bold and italic write their
      // Markdown, as in the rendered view.
      sourceKeys,
      keymap.of([
        ...(plain
          ? []
          : [
              { key: "Mod-b", run: (v: EditorView) => formatSource(v, "bold") },
              {
                key: "Mod-i",
                run: (v: EditorView) => formatSource(v, "italic"),
              },
            ]),
        { key: "Tab", run: sourceTab, shift: indentLess },
        ...standardKeymap,
        ...historyKeymap,
      ]),
      sourceFind,
      plain ?? [sourceHighlighting(), sourceEscapes()],
      // A caller's paste handler (a document's source stores pictures);
      // anything it leaves alone is CodeMirror's own.
      EditorView.domEventHandlers({
        paste: (event, view) => pasteRef.current?.(event, view) ?? false,
        copy: (_event, view) => (tellSelection(view, false), false),
        cut: (_event, view) => (tellSelection(view, true), false),
      }),
      compartment.of(readOnlyOf(latest.current.readOnly)),
      ...latest.current.more,
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet) touched = true;
        if (
          update.docChanged &&
          !update.transactions.some((tr) => tr.annotation(outside))
        ) {
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(report, REPORT_MS);
        }
        if (
          latest.current.typewriter &&
          (update.docChanged || update.selectionSet)
        )
          requestAnimationFrame(() => centerSourceCaret(update.view));
      }),
    ];
    // The tab's last source view left its undo, selection and scroll: this
    // one starts from them, for the same text. Only a view that was used
    // leaves anything: one mounted and gone unseen would leave the top.
    const { tabId } = latest.current;
    const left = tabId ? sourceLeftBy(tabId, latest.current.value) : null;
    const view = new EditorView({
      parent: host,
      state: left
        ? EditorState.fromJSON(
            left.state,
            { extensions },
            { history: historyField },
          )
        : EditorState.create({ doc: latest.current.value, extensions }),
    });
    if (left) view.dispatch({ effects: left.scroll as StateEffect<unknown> });
    viewRef.current = view;
    const edit = (action: SourceEdit) => {
      ({ undo, redo, "select-all": selectAll })[action](view);
      view.focus();
    };
    registerSourceView(host, view, edit);
    const stopZoomPane = tabId
      ? registerZoomPane(tabId, {
          kind: "source",
          scroller: view.scrollDOM,
          view,
        })
      : undefined;
    const stopFlush = tabId
      ? registerTabEditor(tabId, "flush", report)
      : undefined;
    const stopJumps = tabId ? followOutlineJumps(tabId, view) : undefined;
    // The keys can go to it once built, as to the rendered editor.
    const stopFocus = tabId
      ? registerTabEditor(tabId, "focus", () => {
          if (mayTakeKeys()) view.focus();
        })
      : undefined;
    const onEdit = (event: Event) => {
      const action = (event as CustomEvent<SourceEdit>).detail;
      if (action === "undo" || action === "redo" || action === "select-all")
        edit(action);
    };
    host.addEventListener(SOURCE_EDIT_EVENT, onEdit);
    const stopFormat = plain ? () => {} : followFormatMenu(view);
    const scroller = view.scrollDOM;
    // Where it is read, taken as it scrolls: once out of sight a view
    // reads as scrolled to the top.
    let place = left?.scroll ?? null;
    const onScrollEvent = () => {
      touched = true;
      place = view.scrollSnapshot();
      latest.current.onScroll?.(scroller);
    };
    scroller.addEventListener("scroll", onScrollEvent, { passive: true });
    return () => {
      report();
      if (tabId && touched)
        leaveSource(tabId, {
          state: view.state.toJSON({ history: historyField }),
          text: view.state.doc.toString(),
          scroll: place ?? view.scrollSnapshot(),
        });
      stopFlush?.();
      stopJumps?.();
      stopFocus?.();
      stopZoomPane?.();
      stopFormat();
      host.removeEventListener(SOURCE_EDIT_EVENT, onEdit);
      scroller.removeEventListener("scroll", onScrollEvent);
      unregisterSourceView(host);
      readOnlyRef.current = null;
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useFollowProps(viewRef, readOnlyRef, value, readOnly);
  const findBar = useSourceFind(viewRef);
  return (
    <>
      <div
        ref={hostRef}
        data-frame-carry=""
        className={`source-view tx-scroll-reveal ${className}${typewriter ? " typewriter-source" : ""}`}
      />
      {findBar}
    </>
  );
}

/** The view follows its props: the tab's markdown changed from outside
 *  (open, reload, an AI edit), and read-only switched. */
function useFollowProps(
  viewRef: React.RefObject<EditorView | null>,
  readOnlyRef: React.RefObject<Compartment | null>,
  value: string,
  readOnly: boolean,
) {
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // Our own text coming back: once it is, older ones can't. One that
    // arrives after a newer edit (an undo right after a paste) is stale.
    const sent = sentBy.get(view) ?? [];
    const ours = sent.indexOf(value);
    sentBy.set(view, ours >= 0 ? sent.slice(ours + 1) : []);
    if (ours >= 0) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    // Only the span that changed, so the caret and scroll keep their place;
    // not an undo step of the user's.
    const { start, end } = sharedEnds(current, value);
    view.dispatch({
      changes: {
        from: start,
        to: current.length - end,
        insert: value.slice(start, value.length - end),
      },
      annotations: [Transaction.addToHistory.of(false), outside.of(true)],
    });
  }, [value, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    const compartment = readOnlyRef.current;
    if (view && compartment)
      view.dispatch({
        effects: compartment.reconfigure(readOnlyOf(readOnly)),
      });
  }, [readOnly, viewRef, readOnlyRef]);
}
