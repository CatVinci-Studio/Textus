import { $prose, $remark } from "@milkdown/kit/utils";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { TYPEWRITER_HOLD } from "../modes/typewriter-plugin";
import { BRACKET_COMPOSITION_DELAY_MS } from "../keys/bracket-autopair-plugin";

const CHECKBOX_HIT_WIDTH = 24;

/**
 * Reads `- [ ] ` with nothing after the box as an empty task item, which is
 * how one is saved before its text is typed; GFM would read it as text.
 * Only an unescaped box: `- \[ ]` is text the user wrote.
 */
const EMPTY_TASK = /^\[([ xX])\]$/;

function readEmptyTaskItems(node: MdastNode): void {
  if (node.type === "listItem" && node.checked == null) {
    const paragraph = node.children?.[0];
    const text =
      paragraph?.type === "paragraph" && paragraph.children?.length === 1
        ? paragraph.children[0]
        : null;
    const match =
      text?.type === "text" ? EMPTY_TASK.exec(text.value ?? "") : null;
    const start = text?.position?.start.offset;
    const end = text?.position?.end.offset;
    if (
      match &&
      paragraph &&
      start !== undefined &&
      end !== undefined &&
      end - start === match[0].length
    ) {
      node.checked = match[1] !== " ";
      paragraph.children = [];
    }
  }
  node.children?.forEach(readEmptyTaskItems);
}

interface MdastNode {
  type: string;
  value?: string;
  checked?: boolean | null;
  children?: MdastNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

export const remarkEmptyTaskItems = $remark(
  "remark-empty-task-items",
  () => () => (tree: MdastNode) => readEmptyTaskItems(tree),
);

/**
 * Draws nothing itself (CSS draws the checkbox) but toggles `checked` when
 * the box area is pressed. On mousedown, default cancelled, so the caret
 * doesn't move and Typewriter Mode doesn't scroll another item under the
 * pointer; TYPEWRITER_HOLD keeps it from recentring after the edit.
 */
export const taskListClickPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleDOMEvents: {
          mousedown(view, event) {
            if (event.button !== 0) return false;
            const target = event.target as HTMLElement | null;
            const li = target?.closest(
              'li[data-item-type="task"]',
            ) as HTMLElement | null;
            if (!li || !view.dom.contains(li)) return false;
            const rect = li.getBoundingClientRect();
            if (event.clientX - rect.left > CHECKBOX_HIT_WIDTH) return false;

            let $pos;
            try {
              $pos = view.state.doc.resolve(view.posAtDOM(li, 0));
            } catch {
              return false;
            }
            for (let depth = $pos.depth; depth > 0; depth--) {
              const node = $pos.node(depth);
              if (node.type.name !== "list_item") continue;
              if (node.attrs.checked == null) return false;
              event.preventDefault();
              view.dispatch(
                view.state.tr
                  .setNodeMarkup($pos.before(depth), undefined, {
                    ...node.attrs,
                    checked: !node.attrs.checked,
                  })
                  .setMeta(TYPEWRITER_HOLD, true),
              );
              return true;
            }
            return false;
          },
        },
      },
    }),
);

// With a Chinese IME, "[" and "]" type as 【 and 】, so the GFM "[ ] " rule
// never fires: an item whose whole text is 【】 or 【x】 (or ［］, "[]"), or a
// paragraph "- 【】", becomes a task. The whole paragraph is checked so a
// paired 【|】 counts. Typed input and IME commits only, never a paste.
const CJK_TASK = /^\s*[【［[]\s*([xX√✓]?)\s*[】］\]]\s*$/;
const CJK_TASK_PARAGRAPH = /^\s*[-*+]\s*[【［[]\s*([xX√✓]?)\s*[】］\]]\s*$/;

// The document and caret right after a conversion: a space typed while both
// are still current is the separator of "[ ] " and is dropped.
const converted = new WeakMap<EditorView, { doc: ProseNode; pos: number }>();

function markConverted(view: EditorView) {
  converted.set(view, {
    doc: view.state.doc,
    pos: view.state.selection.head,
  });
}

function convertCjkTask(
  view: EditorView,
  // The paragraph's text as it will read once this input lands.
  text: string,
): boolean {
  const { state } = view;
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== "paragraph") return false;
  const paraStart = $from.start();
  const paraEnd = $from.end();
  const item = $from.depth >= 2 ? $from.node($from.depth - 1) : null;

  if (item?.type.name === "list_item" && $from.index($from.depth - 1) === 0) {
    const match = CJK_TASK.exec(text);
    if (!match || item.attrs.checked != null) return false;
    const tr = state.tr
      .delete(paraStart, paraEnd)
      .setNodeMarkup($from.before($from.depth - 1), undefined, {
        ...item.attrs,
        checked: match[1] !== "",
      });
    view.dispatch(tr.scrollIntoView());
    markConverted(view);
    return true;
  }

  const match = CJK_TASK_PARAGRAPH.exec(text);
  const { bullet_list, list_item, paragraph } = state.schema.nodes;
  if (!match || item?.type.name === "list_item") return false;
  if (!bullet_list || !list_item || !paragraph) return false;
  // Only where a list can stand in for the paragraph: in a table cell it
  // would split the table.
  const index = $from.index($from.depth - 1);
  if (
    !$from.node($from.depth - 1).canReplaceWith(index, index + 1, bullet_list)
  )
    return false;
  const list = bullet_list.create(null, [
    list_item.create({ checked: match[1] !== "" }, paragraph.create()),
  ]);
  const before = $from.before();
  const tr = state.tr.replaceWith(before, $from.after(), list);
  // Inside the new paragraph: list, item, paragraph openings.
  tr.setSelection(TextSelection.create(tr.doc, before + 3));
  view.dispatch(tr.scrollIntoView());
  markConverted(view);
  return true;
}

export const cjkTaskInputPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleTextInput(view, from, to, text) {
          if (view.composing) return false;
          const last = converted.get(view);
          converted.delete(view);
          const justConverted =
            last?.doc === view.state.doc &&
            last.pos === view.state.selection.head;
          if (justConverted && text === " ") return true;
          // A box made at its paired "[ ]" before its "]" was typed: that "]", and
          // the space after it.
          if (justConverted && /^[\]】］]$/.test(text)) {
            markConverted(view);
            return true;
          }
          const { $from } = view.state.selection;
          if ($from.parent.type.name !== "paragraph") return false;
          const start = $from.start();
          const full =
            view.state.doc.textBetween(start, from) +
            text +
            view.state.doc.textBetween(to, $from.end());
          return convertCjkTask(view, full);
        },
        handleDOMEvents: {
          // An IME commit doesn't go through handleTextInput; look once the commit is
          // read back in and a committed 【 has its 】.
          compositionend(view, event) {
            const committed = event.data ?? "";
            setTimeout(() => {
              if (view.composing || view.isDestroyed) return;
              const { $from } = view.state.selection;
              if ($from.parent.type.name !== "paragraph") return;
              // The 】 of a box made at its paired 【】, as above.
              const last = converted.get(view);
              if (
                /^[\]】］]$/.test(committed) &&
                $from.parent.textContent === committed &&
                last?.pos === $from.pos - committed.length
              ) {
                view.dispatch(view.state.tr.delete($from.start(), $from.end()));
                markConverted(view);
                return;
              }
              convertCjkTask(view, $from.parent.textContent);
            }, BRACKET_COMPOSITION_DELAY_MS + 10);
            return false;
          },
        },
      },
    }),
);
