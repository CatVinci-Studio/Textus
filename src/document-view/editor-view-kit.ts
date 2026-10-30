import { vi } from "vitest";
import { editorViewCtx, serializerCtx, type Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  readSourceBlocks,
  writePreservingSource,
} from "../editor/markdown/source-preserving";
import type { Settings } from "../prefs/SettingsContext";
import { createTestEditor } from "./editor-test-harness";

// Test-only: the editor of createTestEditor driven as a keyboard drives it,
// for key and typing tests that need no real browser. Keys reach the editor
// as DOM keydowns, so its keymaps and handlers run; what the browser itself
// does with a key (moving the caret by an arrow) doesn't happen here.

// What jsdom lacks for the editor: a diagram never renders, CSS.escape.
vi.mock("mermaid", () => ({
  default: { initialize() {}, render: () => new Promise(() => {}) },
}));
const css = (globalThis.CSS ?? {}) as { escape?: (value: string) => string };
css.escape ??= (value) => value.replace(/["\\]/g, "\\$&");
(globalThis as { CSS?: unknown }).CSS = css;

export interface TestView {
  view: EditorView;
  editor: Editor;
  /** The document as the app saves it, blocks as opened kept as written. */
  markdown(): string;
  /** Types `text` a character at a time, through the input rules. */
  type(text: string): void;
  /** Presses "Enter", "Shift+Tab", "Mod+b"…; true when the editor took it. */
  press(key: string): boolean;
  /** Pastes as the clipboard of another app would: its plain text and,
   *  given, its HTML. */
  paste(text: string, html?: string): void;
  /** The selected text, blocks joined with "\n". */
  selected(): string;
  /** The caret's block as text, "|" where the caret is. */
  caretLine(): string;
  /** The caret `offset` characters into the first text node holding
   *  `text`, or `length` characters from there selected; its position. */
  caretAt(text: string, offset?: number, length?: number): number;
  /** The selection from `anchor` to `head`, document positions. */
  select(anchor: number, head?: number): void;
  /** The caret at the end of the document. */
  caretAtEnd(): void;
}

const opened: Editor[] = [];

/** Destroys every editor openView made: for afterEach. */
export async function closeViews(): Promise<void> {
  await Promise.all(opened.splice(0).map((editor) => editor.destroy()));
}

/** `markdown` opened as a file is, the caret at its end. `ai` lets the AI
 *  features run, as they do outside the tutorial. */
export async function openView(
  markdown = "",
  settings: Partial<Settings> = {},
  options: { ai?: boolean } = {},
): Promise<TestView> {
  const editor = await createTestEditor(markdown, settings, options);
  opened.push(editor);
  const view = editor.ctx.get(editorViewCtx);
  const source = editor.action((ctx) =>
    readSourceBlocks(ctx, markdown, view.state.doc),
  );
  const select = (from: number, to = from) =>
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, from, to),
      ),
    );
  const caretAtEnd = () =>
    view.dispatch(
      view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)),
    );
  caretAtEnd();

  return {
    view,
    editor,
    markdown: () =>
      editor
        .action((ctx) =>
          source
            ? writePreservingSource(ctx, source, view.state.doc)
            : ctx.get(serializerCtx)(view.state.doc),
        )
        .trim(),
    type(text) {
      for (const ch of text) {
        const { from, to } = view.state.selection;
        const handled = view.someProp("handleTextInput", (f) =>
          f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
        );
        if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
      }
    },
    press(combo) {
      const parts = combo.split("+");
      const key = parts.pop()!;
      const mods = new Set(parts.map((part) => part.toLowerCase()));
      const event = new KeyboardEvent("keydown", {
        key,
        // The physical key, as a US keyboard has it: some handlers read it.
        code: /^[a-z]$/i.test(key)
          ? `Key${key.toUpperCase()}`
          : /^[0-9]$/.test(key)
            ? `Digit${key}`
            : key,
        bubbles: true,
        cancelable: true,
        shiftKey: mods.has("shift"),
        altKey: mods.has("alt"),
        // jsdom is no Mac: Mod is Ctrl.
        ctrlKey: mods.has("mod") || mods.has("ctrl"),
        metaKey: mods.has("meta"),
      });
      view.dom.dispatchEvent(event);
      if (event.defaultPrevented) return true;
      // A Backspace or Delete no handler took is the browser's own: one
      // character, or the selection.
      const { from, to, empty } = view.state.selection;
      const plain = !mods.has("mod") && !mods.has("alt");
      if (plain && (key === "Backspace" || key === "Delete")) {
        const [a, b] = !empty
          ? [from, to]
          : key === "Backspace"
            ? [from - 1, from]
            : [from, from + 1];
        view.dispatch(view.state.tr.delete(a, b));
      }
      return false;
    },
    paste(text, html) {
      const data: Record<string, string> = { "text/plain": text };
      if (html !== undefined) data["text/html"] = html;
      // jsdom has neither ClipboardEvent nor DataTransfer: what ProseMirror
      // and the app's paste handlers read of them.
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          types: Object.keys(data),
          files: [],
          items: [],
          getData: (type: string) => data[type] ?? "",
        },
      });
      view.dom.dispatchEvent(event);
    },
    caretLine() {
      const { $head } = view.state.selection;
      const block = $head.parent;
      const before = block.textBetween(0, $head.parentOffset, "\n", " ");
      const after = block.textBetween(
        $head.parentOffset,
        block.content.size,
        "\n",
        " ",
      );
      return `${before}|${after}`;
    },
    selected() {
      const { from, to } = view.state.selection;
      return view.state.doc.textBetween(from, to, "\n");
    },
    caretAt(text, offset = 0, length = 0) {
      let at = -1;
      view.state.doc.descendants((node, pos) => {
        if (at < 0 && node.isText && node.text!.includes(text))
          at = pos + node.text!.indexOf(text) + offset;
        return at < 0;
      });
      if (at < 0) throw new Error(`no text "${text}" in the document`);
      select(at, at + length);
      return at;
    },
    select,
    caretAtEnd,
  };
}
