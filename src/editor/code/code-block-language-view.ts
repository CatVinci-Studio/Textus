import { $view } from "@milkdown/kit/utils";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { Decoration } from "@milkdown/kit/prose/view";
import { copyButton, widgetButton } from "../widget-button";
import { LINE_NUMBERS_SPEC } from "./code-line-numbers-plugin";
import { mountLanguagePicker } from "./code-language-picker";
import { fitGutter } from "./gutter-fit";
import { addedLanguageNames } from "./code-languages";

// A common subset, so the menu still fits on screen.
const LANGUAGES = [
  "",
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "csharp",
  "ruby",
  "php",
  "swift",
  "kotlin",
  "bash",
  "json",
  "yaml",
  "toml",
  "sql",
  "html",
  "css",
  "scss",
  "markdown",
  "diff",
];

/** The menu's languages: the common ones, then those plugins add. */
export function pickerLanguages(added: readonly string[]): string[] {
  return [...LANGUAGES, ...added.filter((name) => !LANGUAGES.includes(name))];
}

/** The line count as the gutter numbers it: a trailing newline starts a
 *  line of its own. */
function lineCount(node: ProseNode): number {
  let lines = 1;
  for (const char of node.textContent) if (char === "\n") lines++;
  return lines;
}

/**
 * Wraps the code block's own <pre><code> (still the contentDOM) with a
 * header at its top right holding the language picker and buttons that
 * copy and select the code, and with line numbers on, a gutter inside the
 * <pre>.
 */
export function createCodeBlockView(
  labels: () => {
    copy: string;
    copied: string;
    selectAll: string;
    language: string;
    languageSearch: string;
  },
) {
  return $view(
    codeBlockSchema.node,
    () => (initialNode, view, getPos, decorations) => {
      let node = initialNode;
      const wrapper = document.createElement("div");
      // md-fences: Typora's class, so imported Typora themes' code-block rules
      // reach it.
      wrapper.className = "code-block-wrapper md-fences";

      const header = document.createElement("div");
      header.className = "block-toolbar code-block-header";
      header.contentEditable = "false";
      const actions = document.createElement("div");
      actions.className = "block-toolbar-actions code-block-actions";
      const picker = document.createElement("div");
      picker.className = "code-block-language";
      header.append(actions);

      const copy = copyButton(labels, () => node.textContent);
      const selectAll = widgetButton("block-pill", labels().selectAll, () => {
        const pos = getPos();
        if (pos == null) return;
        const { tr } = view.state;
        view.dispatch(
          tr.setSelection(
            TextSelection.create(tr.doc, pos + 1, pos + node.nodeSize - 1),
          ),
        );
        view.focus();
      });
      actions.append(picker, copy, selectAll);

      // Mounted on first hover or focus: a long document has many blocks.
      let languagePicker: ReturnType<typeof mountLanguagePicker> | null = null;
      let shownLanguage: string | null = null;
      let shownAdded: readonly string[] | null = null;
      function syncPicker() {
        const value = (node.attrs.language as string) ?? "";
        const added = addedLanguageNames();
        if (!languagePicker) return;
        if (value === shownLanguage && added === shownAdded) return;
        shownLanguage = value;
        shownAdded = added;
        languagePicker.render({
          value,
          languages: pickerLanguages(added),
          label: labels().language,
          searchLabel: labels().languageSearch,
          onOpenChange: (open) =>
            wrapper.classList.toggle("is-picking-language", open),
          onChange: (language) => {
            const pos = getPos();
            if (pos == null) return;
            // Only the language: the fence's meta (` title="a.js"`) stays.
            view.dispatch(
              view.state.tr.setNodeAttribute(pos, "language", language),
            );
            view.focus();
          },
        });
      }
      const showPicker = () => {
        if (languagePicker) return;
        languagePicker = mountLanguagePicker(picker);
        syncPicker();
      };

      const pre = document.createElement("pre");
      const code = document.createElement("code");
      pre.appendChild(code);

      // Line numbers: redrawn only when the count changes, each as tall as its
      // (wrapping) line after any change to the text or width.
      const gutter = document.createElement("span");
      gutter.className = "code-line-gutter";
      gutter.contentEditable = "false";
      gutter.setAttribute("aria-hidden", "true");
      let numberedLines = 0;
      let fitting = 0;
      const fitSoon = () => {
        cancelAnimationFrame(fitting);
        fitting = requestAnimationFrame(() => fitGutter(gutter, code));
      };
      let resized: ResizeObserver | null = null;
      function syncGutter(
        currentNode: ProseNode,
        currentDecorations: readonly Decoration[],
      ) {
        const on = currentDecorations.some(
          (d) => (d.spec as Record<string, unknown>)[LINE_NUMBERS_SPEC],
        );
        if (!on) {
          gutter.remove();
          resized?.disconnect();
          numberedLines = 0;
          return;
        }
        if (!gutter.isConnected) {
          pre.insertBefore(gutter, code);
          resized ??= new ResizeObserver(fitSoon);
          resized.observe(code);
        }
        fitSoon();
        const lines = lineCount(currentNode);
        if (lines === numberedLines) return;
        numberedLines = lines;
        gutter.replaceChildren(
          ...Array.from({ length: lines }, (_, i) => {
            const line = document.createElement("span");
            line.textContent = String(i + 1);
            return line;
          }),
        );
      }
      syncGutter(node, decorations);

      wrapper.appendChild(header);
      wrapper.appendChild(pre);
      wrapper.addEventListener("pointerenter", showPicker);
      wrapper.addEventListener("focusin", showPicker);

      return {
        dom: wrapper,
        contentDOM: code,
        update(updatedNode, updatedDecorations) {
          if (updatedNode.type !== node.type) return false;
          node = updatedNode;
          syncPicker();
          syncGutter(updatedNode, updatedDecorations);
          return true;
        },
        // Keys on the header's buttons aren't the editor's.
        stopEvent: (event) => header.contains(event.target as Node),
        // The header's label and the gutter change under the view's
        // DOM observer; only the code is the document's.
        ignoreMutation(mutation) {
          if (mutation.type === "selection") return false;
          return !code.contains(mutation.target);
        },
        destroy() {
          cancelAnimationFrame(fitting);
          resized?.disconnect();
          languagePicker?.destroy();
        },
      };
    },
  );
}
