import { sourceFind } from "../find/cm-find";
import { useSourceFind } from "../find/useSourceFind";
import { useEffect, useRef } from "react";
import {
  Annotation,
  Compartment,
  EditorState,
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
  historyKeymap,
  redo,
  selectAll,
  standardKeymap,
  undo,
} from "@codemirror/commands";
import { centerSourceCaret } from "./mode-switch";
import { sourceHighlighting } from "./source-highlight";
import { sourceEscapes } from "./source-escapes";
import {
  registerSourceView,
  unregisterSourceView,
  type SourceEdit,
} from "./source-view-registry";
import { SOURCE_EDIT_EVENT } from "../../utils/events";
import { followFormatMenu, formatSource } from "./source-format-events";
import { tellCopied } from "../../clipboard/copied";
import { elasticOverscroll } from "../../engine/controls/elastic-overscroll";
import "./source-editor.css";

/** A change the tab's markdown made, not the user. */
const outside = Annotation.define<boolean>();
/** The texts each editor's edits reported, not yet seen coming back. */
const sentBy = new WeakMap<EditorView, string[]>();

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
}: SourceEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyRef = useRef<Compartment | null>(null);
  const latest = useRef({ value, onChange, typewriter, readOnly, onScroll });
  latest.current = { value, onChange, typewriter, readOnly, onScroll };
  // The extension is built once; it reads the current handler through here.
  const pasteRef = useRef(onPaste);
  pasteRef.current = onPaste;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const compartment = new Compartment();
    readOnlyRef.current = compartment;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          // Source mode edits as plain text does, with colours: no line or
          // word highlights, multiple carets, auto-indent or code keys.
          history(),
          drawSelection(),
          dropCursor(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            spellcheck: "false",
            autocorrect: "off",
            autocapitalize: "off",
          }),
          // The plain-text keys only: no searchKeymap (Ctrl/Cmd+F is
          // Textus's own find bar), and Tab moves the focus as in any field.
          // Bold and italic write their Markdown, as in the rendered view.
          keymap.of([
            { key: "Mod-b", run: (v) => formatSource(v, "bold") },
            { key: "Mod-i", run: (v) => formatSource(v, "italic") },
            ...standardKeymap,
            ...historyKeymap,
          ]),
          sourceFind,
          sourceHighlighting(),
          sourceEscapes(),
          // A caller's paste handler (a document's source stores pictures);
          // anything it leaves alone is CodeMirror's own.
          EditorView.domEventHandlers({
            paste: (event, view) => pasteRef.current?.(event, view) ?? false,
            copy: (_event, view) => (tellSelection(view, false), false),
            cut: (_event, view) => (tellSelection(view, true), false),
          }),
          compartment.of(readOnlyOf(latest.current.readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const text = update.state.doc.toString();
              if (!update.transactions.some((tr) => tr.annotation(outside)))
                sentBy.set(update.view, [
                  ...(sentBy.get(update.view) ?? []),
                  text,
                ]);
              latest.current.onChange(text);
            }
            if (
              latest.current.typewriter &&
              (update.docChanged || update.selectionSet)
            )
              requestAnimationFrame(() => centerSourceCaret(update.view));
          }),
        ],
      }),
    });
    viewRef.current = view;
    const edit = (action: SourceEdit) => {
      ({ undo, redo, "select-all": selectAll })[action](view);
      view.focus();
    };
    registerSourceView(host, view, edit);
    const onEdit = (event: Event) => {
      const action = (event as CustomEvent<SourceEdit>).detail;
      if (action === "undo" || action === "redo" || action === "select-all")
        edit(action);
    };
    host.addEventListener(SOURCE_EDIT_EVENT, onEdit);
    const stopFormat = followFormatMenu(view);
    const scroller = view.scrollDOM;
    const onScrollEvent = () => latest.current.onScroll?.(scroller);
    scroller.addEventListener("scroll", onScrollEvent, { passive: true });
    // The same give at either end as the rendered view's, on a Mac.
    const stopElastic = elasticOverscroll(scroller, view.dom);
    return () => {
      stopElastic();
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
    let start = 0;
    const most = Math.min(current.length, value.length);
    while (start < most && current[start] === value[start]) start++;
    let end = 0;
    while (
      end < most - start &&
      current[current.length - 1 - end] === value[value.length - 1 - end]
    )
      end++;
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
