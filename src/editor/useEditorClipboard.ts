import { useCallback } from "react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { Slice } from "@milkdown/kit/prose/model";
import { AllSelection } from "@milkdown/kit/prose/state";
import type { EditorRunner } from "./useEditorRunner";
import { recordClipboardEntry } from "../clipboard/history";
import { parseMarkdownSource } from "./markdown/parse-markdown-source";
import { pastePlainText } from "./markdown/paste-plain";
import { plainTextOf } from "./markdown/plain-text";
import { bareUrl, insertUrlLink } from "./markdown/paste-url";

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

/** The selection as Markdown source; its bare text if that won't
 *  serialize. */
function selectionMarkdown(ctx: Ctx): string {
  const { state } = ctx.get(editorViewCtx);
  const { from, to } = state.selection;
  try {
    return ctx.get(serializerCtx)(state.doc.cut(from, to)).trimEnd();
  } catch {
    return state.doc.textBetween(from, to, "\n");
  }
}

export function useEditorClipboard(run: EditorRunner): EditorClipboard {
  const copyOrCut = useCallback(
    (cut: boolean) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        // The history keeps the Markdown source, as for Cmd+C
        // (clipboard/history-plugin.ts).
        const markdown = selectionMarkdown(ctx);
        // The clipboard gets what Cmd+C puts there: the formatted HTML, and
        // the Markdown source as plain text (copy-text-plugin.ts).
        const { dom, text } = view.serializeForClipboard(
          state.selection.content(),
        );
        void (async () => {
          if (markdown) {
            try {
              await navigator.clipboard.write([
                new ClipboardItem({
                  "text/html": new Blob([dom.innerHTML], { type: "text/html" }),
                  "text/plain": new Blob([text], { type: "text/plain" }),
                }),
              ]);
            } catch {
              // A webview without ClipboardItem: the plain text alone.
              await navigator.clipboard.writeText(text);
            }
            // navigator.clipboard bypasses the DOM copy event the history's
            // document-level capture listens on - record explicitly.
            recordClipboardEntry(markdown);
          }
          if (cut) view.dispatch(view.state.tr.deleteSelection());
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
              .replaceSelection(Slice.maxOpen(doc.content))
              .scrollIntoView(),
          );
          inserted = true;
        }
        if (!inserted) view.dispatch(view.state.tr.insertText(text));
        view.focus();
      });
    },
    [run],
  );

  const paste = useCallback(() => {
    void (async () => {
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
      view.dispatch(
        view.state.tr.setSelection(new AllSelection(view.state.doc)),
      );
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
