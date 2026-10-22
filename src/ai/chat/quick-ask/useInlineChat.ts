import { useCallback, useRef, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  cachedDocument,
  caretContext,
  headingAt,
  readSelection,
  serializeRange,
  type DocumentSnapshot,
} from "../../doc-markdown";
import { chatSelectionRange } from "./chat-selection-plugin";
import type { EditorRunner } from "../../../editor/useEditorRunner";

/** The document position right after the top-level block containing `pos` -
 *  where the Quick Ask zone widget goes (quick-ask-widget-plugin), both when
 *  the chat first opens (relative to the selection) and when the review nav
 *  bar moves it to follow a pending edit (relative to the edit's `from`). A
 *  real ProseMirror position, so it maps through edits like any other one. */
export function blockPositionAfter(doc: ProseNode, pos: number): number {
  const $pos = doc.resolve(Math.min(pos, doc.content.size));
  if ($pos.depth >= 1) return $pos.after(1);
  // Between two top-level blocks - where an anchored proposal's preview
  // starts: the block that begins here. (This used to be the document's
  // end, which sent Quick Ask to the bottom of the page.)
  const next = $pos.nodeAfter;
  return next ? $pos.pos + next.nodeSize : doc.content.size;
}

export interface InlineChatInfo {
  /** The whole document as MARKDOWN SOURCE - see doc-markdown.ts for why
   *  every AI path works in markdown rather than flattened text. */
  document: DocumentSnapshot;
  /** The selection as plain text. Display only (the composer's "{n} chars
   *  selected" chip); never sent to the model, which sees the markdown. */
  selectedText: string | null;
  /** The selection as markdown - what rides along with the request, and what
   *  a replace_selection proposal's staleness check compares against. */
  selectionMarkdown: string | null;
  /** Selection bounds at open time - what "replace selection" targets. */
  range: { from: number; to: number } | null;
  /** Caret position at open time - what "insert at cursor" targets. */
  anchor: number;
  /** The document position right after the top-level block the selection
   *  ends in - where quick-ask-widget-plugin places the panel. A real
   *  ProseMirror position, so it maps through edits like any other one
   *  (unlike the old floating popup's screen coordinates, which never
   *  followed the document). */
  widgetPos: number;
}

/**
 * State + actions for the Quick Ask bar. Opening captures the document, the
 * selection (plain + markdown + bounds), and the block position the panel
 * should render after - the range a `replace_selection` proposal targets,
 * and what usePendingEdits re-checks for staleness before writing.
 *
 * Nothing here writes to the document. A reply reaches the document only as a
 * pending preview the user accepts (usePendingEdits.ts) - there is no
 * second, direct-apply path.
 */
export function useInlineChat(run: EditorRunner) {
  const [chatInfo, setChatInfo] = useState<InlineChatInfo | null>(null);
  // Whether the PANEL is on screen. Separate from chatInfo because detaching
  // into a window hides the panel while the context must survive: proposals
  // arriving from the detached window still resolve against the selection and
  // document captured when this request was made.
  const [visible, setVisible] = useState(false);
  // Read from callbacks registered once (the detached-chat bridge), which
  // would otherwise close over a stale chatInfo.
  // Writable (unlike useLatest) because open/sendContext update it in the
  // same tick as setChatInfo, before the re-render that would sync it.
  const chatInfoRef = useRef<InlineChatInfo | null>(chatInfo);
  chatInfoRef.current = chatInfo;

  /** Opens the bar, or keeps it open. Opened again over a DIFFERENT
   *  selection, it retargets: the new passage becomes what it is about, and
   *  the returned position is where the panel should move to (null: it
   *  stays put). Asking AI about paragraph 9 used to leave the panel - and
   *  its rewrites - on paragraph 1. The conversation itself carries on;
   *  the caller decides whether it is fresh or a restored history entry. */
  const open = useCallback((): number | null => {
    setVisible(true);
    return (
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { selection } = view.state;
        const prev = chatInfoRef.current;
        const sameTarget =
          prev !== null &&
          (selection.empty ||
            (prev.range?.from === selection.from &&
              prev.range?.to === selection.to));
        if (sameTarget) return null;
        const next: InlineChatInfo = {
          document: cachedDocument(ctx, view.state.doc),
          ...readSelection(ctx, view.state),
          anchor: selection.from,
          widgetPos: blockPositionAfter(view.state.doc, selection.to),
        };
        chatInfoRef.current = next;
        setChatInfo(next);
        return prev ? next.widgetPos : null;
      }) ?? null
    );
  }, [run, chatInfoRef]);

  /** Panel off, context kept - what detaching into a window does. */
  const hide = useCallback(() => setVisible(false), []);

  const close = useCallback(() => {
    setVisible(false);
    chatInfoRef.current = null;
    setChatInfo(null);
  }, []);

  /** What a send writes against: the document as it reads NOW, and the
   *  captured selection as it reads now - its range mapped through every
   *  edit since (chat-selection-plugin), so "make it shorter" -> Accept ->
   *  "now more formal" works on the text the first rewrite left behind
   *  instead of quoting text that no longer exists. */
  const sendContext = useCallback(async () => {
    const info = chatInfoRef.current;
    if (!info) return null;
    const fresh = run((ctx) => {
      const { state } = ctx.get(editorViewCtx);
      const range = info.range
        ? (chatSelectionRange(state) ?? info.range)
        : null;
      const valid =
        range && range.to <= state.doc.content.size && range.from < range.to;
      return {
        document: cachedDocument(ctx, state.doc),
        // Opened with no selection: the caret is what "here" means.
        cursor: info.range ? null : caretContext(state),
        focusHeading: headingAt(state.doc, range?.from ?? state.selection.from),
        range: valid ? range : null,
        selectionMarkdown: valid
          ? serializeRange(ctx, state.doc, range.from, range.to)
          : null,
        selectedText: valid
          ? state.doc.textBetween(range.from, range.to, " ")
          : null,
      };
    });
    if (!fresh) {
      return {
        document: info.document,
        selectionMarkdown: info.selectionMarkdown,
        range: info.range,
        cursor: null,
      };
    }
    if (info.range) {
      const next = {
        ...info,
        range: fresh.range,
        selectionMarkdown: fresh.selectionMarkdown,
        selectedText: fresh.selectedText,
      };
      chatInfoRef.current = next;
      setChatInfo(next);
    }
    return {
      document: fresh.document,
      selectionMarkdown: info.range ? fresh.selectionMarkdown : null,
      range: fresh.range,
      cursor: fresh.cursor,
      focusHeading: fresh.focusHeading,
    };
  }, [run, chatInfoRef]);

  return { chatInfo, chatInfoRef, visible, open, hide, close, sendContext };
}
