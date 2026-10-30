import { useCallback } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  AllSelection,
  Selection,
  TextSelection,
} from "@milkdown/kit/prose/state";
import type { EditorRunner } from "./useEditorRunner";
import { recordClipboardEntry } from "../clipboard/history";
import {
  openToText,
  parseMarkdownSource,
} from "./markdown/parse-markdown-source";
import { pastePlainText } from "./markdown/paste-plain";
import { clipboardIpc } from "../platform/ipc";
import { plainTextOf } from "./markdown/plain-text";
import { bareUrl, insertUrlLink } from "./markdown/paste-url";
import {
  selectedPictureAsPng,
  writeClipboard,
} from "./images/picture-clipboard";

export interface EditorClipboard {
  copyOrCut: (cut: boolean) => void;
  /** The selection's words as they read, for an app that shouldn't get
   *  the Markdown marks a copy's plain text carries. */
  copyAsPlainText: () => void;
  paste: () => void;
  pasteAsPlainText: () => void;
  selectAll: () => void;
  /** Insert arbitrary markdown text at the cursor, exactly like pasting it. */
  insertText: (text: string) => void;
}

/**
 * Clipboard actions for the menus, which can't go through the native
 * clipboard events: copy/cut put on the clipboard what Cmd+C does (the
 * formatted HTML, and the Markdown source as plain text), and paste hands
 * the clipboard's content to the editor's paste handling, as Cmd+V does.
 */
/** The clipboard as a paste event's data: its text, HTML and images; its
 *  text alone where the webview can't read more. */
async function clipboardData(): Promise<DataTransfer | null> {
  const data = new DataTransfer();
  try {
    for (const item of await navigator.clipboard.read()) {
      for (const type of item.types) {
        const blob = await item.getType(type);
        if (type.startsWith("image/"))
          data.items.add(new File([blob], "pasted", { type }));
        else if (type === "text/plain" || type === "text/html")
          data.setData(type, await blob.text());
      }
    }
  } catch {
    const text = await navigator.clipboard.readText().catch(() => "");
    if (text) data.setData("text/plain", text);
  }
  return data.items.length > 0 ? data : null;
}

/** All of `doc`. WebKit draws no highlight for a selection that starts or
 *  ends beside a code block; there it runs from its first character to its
 *  last. */
function wholeDocument(doc: ProseNode): Selection {
  const start = Selection.atStart(doc);
  const end = Selection.atEnd(doc);
  const codeAtEdge = [doc.firstChild, doc.lastChild].some(
    (node) => node?.type.spec.code,
  );
  return codeAtEdge &&
    start instanceof TextSelection &&
    end instanceof TextSelection
    ? TextSelection.create(doc, start.from, end.to)
    : new AllSelection(doc);
}

export function useEditorClipboard(run: EditorRunner): EditorClipboard {
  const copyOrCut = useCallback(
    (cut: boolean) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        // What Cmd+C puts there: the formatted HTML, and the Markdown
        // source as plain text (copy-text-plugin.ts).
        const { dom, text } = view.serializeForClipboard(
          state.selection.content(),
        );
        const png = selectedPictureAsPng(view);
        void (async () => {
          if (text) {
            await writeClipboard(dom.innerHTML, text, png);
            // navigator.clipboard bypasses the DOM copy event the history's
            // document-level capture listens on - record explicitly.
            recordClipboardEntry(text);
          }
          if (cut)
            view.dispatch(
              view.state.tr.deleteSelection().setMeta("uiEvent", "cut"),
            );
          view.focus();
        })();
      });
    },
    [run],
  );

  const copyAsPlainText = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const text = plainTextOf(view.state.selection.content().content);
      if (!text) return;
      void (async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        recordClipboardEntry(text);
        view.focus();
      })();
    });
  }, [run]);

  const insertText = useCallback(
    (text: string) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const url = bareUrl(text);
        if (url !== null && insertUrlLink(view, url)) {
          view.focus();
          return;
        }
        let inserted = false;
        const doc = parseMarkdownSource(ctx, text);
        if (doc && doc.content.size > 0) {
          view.dispatch(
            view.state.tr
              .replaceSelection(openToText(doc.content))
              .setMeta("uiEvent", "paste")
              .scrollIntoView(),
          );
          inserted = true;
        }
        if (!inserted)
          view.dispatch(
            view.state.tr.insertText(text).setMeta("uiEvent", "paste"),
          );
        view.focus();
      });
    },
    [run],
  );

  const paste = useCallback(() => {
    void (async () => {
      run((ctx) => ctx.get(editorViewCtx).focus());
      if (await clipboardIpc.pasteNatively().catch(() => false)) return;
      const data = await clipboardData();
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.focus();
        if (data)
          view.dom.dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData: data,
              bubbles: true,
              cancelable: true,
            }),
          );
      });
    })();
  }, [run]);

  const pasteAsPlainText = useCallback(() => {
    run((ctx) => void pastePlainText(ctx.get(editorViewCtx)));
  }, [run]);

  const selectAll = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setSelection(wholeDocument(view.state.doc)));
      view.focus();
    });
  }, [run]);

  return {
    copyOrCut,
    copyAsPlainText,
    paste,
    pasteAsPlainText,
    selectAll,
    insertText,
  };
}
