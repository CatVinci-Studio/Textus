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

/** The document position right after the top-level block containing `pos`:
 *  where the Quick Ask zone widget goes. Maps through edits like any other. */
export function blockPositionAfter(doc: ProseNode, pos: number): number {
  const $pos = doc.resolve(Math.min(pos, doc.content.size));
  if ($pos.depth >= 1) return $pos.after(1);
  // Between two top-level blocks, where an anchored proposal's preview
  // starts: the block that begins here.
  const next = $pos.nodeAfter;
  return next ? $pos.pos + next.nodeSize : doc.content.size;
}

export interface InlineChatInfo {
  /** The whole document as markdown source. */
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
   *  ends in, where the panel goes. Maps through edits like any other. */
  widgetPos: number;
}

/**
 * State + actions for the Quick Ask bar. Opening captures the document, the
 * selection and the panel's position. Nothing here writes to the document:
 * a reply reaches it only as a pending preview the user accepts.
 */
export function useInlineChat(run: EditorRunner) {
  const [chatInfo, setChatInfo] = useState<InlineChatInfo | null>(null);
  // Whether the PANEL is on screen. Separate from chatInfo because detaching
  // hides the panel while the captured context must survive.
  const [visible, setVisible] = useState(false);
  // Read from callbacks registered once. Writable (unlike useLatest) because
  // open/sendContext update it in the same tick as setChatInfo.
  const chatInfoRef = useRef<InlineChatInfo | null>(chatInfo);
  chatInfoRef.current = chatInfo;

  /** Opens the bar, or keeps it open. Over a different selection it
   *  retargets, returning where the panel should move (null: it stays put).
   *  The conversation itself carries on. */
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

  /** What a send writes against: the document as it reads now, and the
   *  captured selection mapped through every edit since, so a follow-up
   *  works on the text the last rewrite left. */
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
