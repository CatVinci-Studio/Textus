import { $view } from "@milkdown/kit/utils";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { Decoration } from "@milkdown/kit/prose/view";
import { recordClipboardEntry } from "../../clipboard/history";
import { LINE_NUMBERS_SPEC } from "./code-line-numbers-plugin";
import { fitGutter } from "./gutter-fit";

// A curated common subset rather than refractor's full ~40-language list -
// enough to cover what people actually fence code with, in a menu that
// still fits on screen.
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

/** How long the copy button says it copied. */
const COPIED_MS = 1500;

/** The block's line count as the gutter numbers it: a trailing newline
 *  starts a line of its own, which the block shows. */
function lineCount(node: ProseNode): number {
  let lines = 1;
  for (const char of node.textContent) if (char === "\n") lines++;
  return lines;
}

/**
 * Code blocks otherwise render via codeBlockSchema's plain toDOM (a bare
 * <pre><code>), which has no way to change the fence's language after the
 * fact. This NodeView wraps that same <pre><code> (still the real
 * contentDOM, so typing/highlighting decorations work exactly as before)
 * with a small header beside it: a button that copies the code and the
 * language picker. A Mermaid block's source, and with it this header, is
 * hidden while its diagram shows; the button copies the source once the
 * block is opened for editing. With line numbers on
 * (code-line-numbers-plugin.ts) a gutter sits inside the <pre>, before
 * the code.
 */
export function createCodeBlockView(
  labels: () => {
    copy: string;
    copied: string;
    language: string;
  },
) {
  return $view(
    codeBlockSchema.node,
    () => (initialNode, view, getPos, decorations) => {
      let node = initialNode;
      const wrapper = document.createElement("div");
      // md-fences: Typora's class for a code block, so imported Typora
      // themes' code-block rules reach it (see theme/typora-compat.ts).
      wrapper.className = "code-block-wrapper md-fences";

      const header = document.createElement("div");
      header.className = "code-block-header";
      header.contentEditable = "false";

      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "code-block-copy";
      copy.textContent = labels().copy;
      let copiedTimer: ReturnType<typeof setTimeout> | undefined;
      // Pressed, it would take the focus and the caret out of the text.
      copy.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      copy.addEventListener("click", () => {
        const text = node.textContent;
        void navigator.clipboard.writeText(text).then(
          () => {
            // navigator.clipboard bypasses the copy event the clipboard
            // history listens for (as useEditorClipboard's Copy does).
            recordClipboardEntry(text);
            copy.textContent = labels().copied;
            copy.classList.add("is-copied");
            clearTimeout(copiedTimer);
            copiedTimer = setTimeout(() => {
              copy.textContent = labels().copy;
              copy.classList.remove("is-copied");
            }, COPIED_MS);
          },
          () => {
            // No clipboard access: nothing was copied, nothing to say.
          },
        );
      });

      const select = document.createElement("select");
      select.className = "code-block-language-select";
      select.setAttribute("aria-label", labels().language);
      for (const lang of LANGUAGES) {
        const opt = document.createElement("option");
        opt.value = lang;
        opt.textContent = lang === "" ? "plain text" : lang;
        select.appendChild(opt);
      }

      function syncSelectValue(currentNode: ProseNode) {
        const lang = (currentNode.attrs.language as string) ?? "";
        // A fence's own spelling (`js`, `sh`, `mermaid`, ...) outside the
        // curated list gets an option of its own: falling back to "plain
        // text" mislabelled a block that is in fact highlighted, and
        // picking from the menu would then have rewritten its fence.
        if (lang && !Array.from(select.options).some((o) => o.value === lang)) {
          const opt = document.createElement("option");
          opt.value = lang;
          opt.textContent = lang;
          select.appendChild(opt);
        }
        select.value = lang;
      }
      syncSelectValue(node);

      select.addEventListener("mousedown", (e) => e.stopPropagation());
      select.addEventListener("change", () => {
        const pos = getPos();
        if (pos == null) return;
        // Only the language: the fence's meta (` title="a.js"`) stays.
        const tr = view.state.tr.setNodeAttribute(
          pos,
          "language",
          select.value,
        );
        view.dispatch(tr);
        view.focus();
      });

      header.append(copy, select);

      const pre = document.createElement("pre");
      const code = document.createElement("code");
      pre.appendChild(code);

      // Line numbers: one per line of the block, redrawn only when the
      // count changes, each as tall as its line - which wraps - after any
      // change to the text or the block's width (gutter-fit.ts).
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
      const resized = new ResizeObserver(fitSoon);
      function syncGutter(
        currentNode: ProseNode,
        currentDecorations: readonly Decoration[],
      ) {
        const on = currentDecorations.some(
          (d) => (d.spec as Record<string, unknown>)[LINE_NUMBERS_SPEC],
        );
        if (!on) {
          gutter.remove();
          resized.disconnect();
          numberedLines = 0;
          return;
        }
        if (!gutter.isConnected) {
          pre.insertBefore(gutter, code);
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

      return {
        dom: wrapper,
        contentDOM: code,
        update(updatedNode, updatedDecorations) {
          if (updatedNode.type !== node.type) return false;
          node = updatedNode;
          syncSelectValue(updatedNode);
          syncGutter(updatedNode, updatedDecorations);
          return true;
        },
        // The header's label and the gutter change under the view's
        // DOM observer; only the code is the document's.
        ignoreMutation(mutation) {
          if (mutation.type === "selection") return false;
          return !code.contains(mutation.target);
        },
        destroy() {
          clearTimeout(copiedTimer);
          cancelAnimationFrame(fitting);
          resized.disconnect();
        },
      };
    },
  );
}
