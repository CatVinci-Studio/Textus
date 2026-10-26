import { useCallback } from "react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { Slice } from "@milkdown/kit/prose/model";
import { AllSelection } from "@milkdown/kit/prose/state";
import type { EditorRunner } from "./useEditorRunner";
import { recordClipboardEntry } from "../clipboard/history";
import { parseMarkdownSource } from "./markdown/parse-markdown-source";
import { bareUrl, insertUrlLink } from "./markdown/paste-url";

export interface EditorClipboard {
  copyOrCut: (cut: boolean) => void;
  /** The selection's Markdown source, for an app that should get the marks
   *  themselves. */
  copyAsMarkdown: () => void;
  paste: () => void;
  selectAll: () => void;
  /** Inserts markdown text at the cursor, as pasting it would. */
  insertText: (text: string) => void;
}

/** The clipboard's HTML when it is a copy from a Textus editor; null when
 *  it isn't, or the webview can't read rich clipboard content. */
async function ownHtml(): Promise<string | null> {
  try {
    for (const item of await navigator.clipboard.read()) {
      if (!item.types.includes("text/html")) continue;
      const html = await (await item.getType("text/html")).text();
      if (html.includes("data-pm-slice")) return html;
    }
  } catch {
    // No rich clipboard access here: the text path.
  }
  return null;
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

/** Clipboard actions for the menus, which can't go through the native
 *  clipboard events: the same results as Cmd+C/V. */
export function useEditorClipboard(run: EditorRunner): EditorClipboard {
  const copyOrCut = useCallback(
    (cut: boolean) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        // The history keeps the Markdown source, as for Cmd+C.
        const markdown = selectionMarkdown(ctx);
        // The clipboard gets what Cmd+C puts there: the HTML, and the words as
        // they read for plain-text apps.
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
            // navigator.clipboard bypasses the copy event the history listens on.
            recordClipboardEntry(markdown);
          }
          if (cut) view.dispatch(view.state.tr.deleteSelection());
          view.focus();
        })();
      });
    },
    [run],
  );

  const copyAsMarkdown = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const markdown = selectionMarkdown(ctx);
      if (!markdown) return;
      void (async () => {
        // The plain text is the source, so every app gets the marks; text/markdown
        // too where the webview allows it (Chromium refuses).
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/plain": new Blob([markdown], { type: "text/plain" }),
              "text/markdown": new Blob([markdown], { type: "text/markdown" }),
            }),
          ]);
        } catch {
          await navigator.clipboard.writeText(markdown).catch(() => {});
        }
        recordClipboardEntry(markdown);
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
      // A copy from Textus itself comes back whole from its HTML: its plain text
      // is the readable flavour, which would lose the formatting.
      const html = await ownHtml();
      if (html) {
        run((ctx) => {
          const view = ctx.get(editorViewCtx);
          view.pasteHTML(html);
          view.focus();
        });
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text) {
        run((ctx) => ctx.get(editorViewCtx).focus());
        return;
      }
      recordClipboardEntry(text);
      insertText(text);
    })();
  }, [run, insertText]);

  const selectAll = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(
        view.state.tr.setSelection(new AllSelection(view.state.doc)),
      );
      view.focus();
    });
  }, [run]);

  return { copyOrCut, copyAsMarkdown, paste, selectAll, insertText };
}
