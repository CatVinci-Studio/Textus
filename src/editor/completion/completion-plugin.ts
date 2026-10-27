import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import {
  hasCompletionSources,
  provideCompletions,
  type CompletionResult,
} from "../../plugins/contributions/completion-sources";
import { CompletionList } from "./completion-list";
import { isImeKeydown } from "../../utils/ime";

/** The most text before the caret a plugin is shown. */
const CONTEXT_CHARS = 200;
const MATH_NODES = new Set(["math_inline", "math_block"]);

/** What is before the caret in its paragraph or formula; null where nothing
 *  is typed. */
function contextAt(view: EditorView): { text: string; inMath: boolean } | null {
  const { selection } = view.state;
  if (!selection.empty) return null;
  const $at = selection.$from;
  const parent = $at.parent;
  const inMath = MATH_NODES.has(parent.type.name);
  if (!inMath && !parent.isTextblock) return null;
  const start = Math.max(0, $at.parentOffset - CONTEXT_CHARS);
  return {
    text: parent.textBetween(start, $at.parentOffset, undefined, "￼"),
    inMath,
  };
}

/**
 * Completions plugins suggest as you type: the text before the caret goes to
 * the plugins whose pattern matches, and the first list back is shown.
 */
export function createCompletionPlugin() {
  return $prose(
    () =>
      new Plugin({
        view(view) {
          const list = new CompletionList();
          let asked = 0;
          let shown: (CompletionResult & { at: number }) | null = null;

          const close = () => {
            asked++;
            shown = null;
            list.hide();
          };
          const take = (index: number) => {
            const open = shown;
            const item = open?.items[index];
            close();
            if (!open || !item) return;
            const caret = item.insert.indexOf("$0");
            const text = item.insert.replace("$0", "");
            const from = open.at - open.replace;
            const tr = view.state.tr.insertText(text, from, open.at);
            const end = from + (caret < 0 ? text.length : caret);
            view.dispatch(
              tr
                .setSelection(TextSelection.create(tr.doc, end))
                .scrollIntoView(),
            );
            view.focus();
            item.run?.();
          };
          const ask = async () => {
            const context = contextAt(view);
            if (!context) return close();
            const token = ++asked;
            const at = view.state.selection.from;
            const doc = view.state.doc;
            const result = await provideCompletions(
              context.text,
              context.inMath,
            );
            // The text moved on while the plugin answered: not this list.
            if (token !== asked || view.state.doc !== doc) return;
            if (!result) return close();
            shown = { ...result, at };
            // Under the start of what an item replaces, as it reads.
            const rect = view.coordsAtPos(at - result.replace);
            list.show(
              result.items,
              { left: rect.left, top: rect.bottom },
              take,
            );
          };
          completionViews.set(view, {
            key: (key) => {
              if (!shown) return false;
              if (key === "Escape") close();
              else if (key === "ArrowDown") list.move(1);
              else if (key === "ArrowUp") list.move(-1);
              else if (key === "Enter" || key === "Tab") take(list.index());
              else return false;
              return true;
            },
          });
          return {
            update(view, previous) {
              if (!hasCompletionSources() || view.composing) return close();
              if (view.state.doc === previous.doc) {
                if (!view.state.selection.eq(previous.selection)) close();
                return;
              }
              void ask();
            },
            destroy() {
              close();
              completionViews.delete(view);
              list.destroy();
            },
          };
        },
        props: {
          handleKeyDown(view, event) {
            if (isImeKeydown(event) || event.metaKey || event.ctrlKey)
              return false;
            if (!completionViews.get(view)?.key(event.key)) return false;
            event.preventDefault();
            return true;
          },
          handleDOMEvents: {
            blur(view) {
              completionViews.get(view)?.key("Escape");
              return false;
            },
          },
        },
      }),
  );
}

/** Each editor's list, for the keys it takes while open. */
const completionViews = new WeakMap<
  EditorView,
  { key(key: string): boolean }
>();
