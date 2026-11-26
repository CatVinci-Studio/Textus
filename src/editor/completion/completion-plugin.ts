import { closeHistory } from "@milkdown/kit/prose/history";
import {
  Plugin,
  TextSelection,
  type EditorState,
} from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { isImeKeydown } from "../../utils/ime";
import { wikilinksIn } from "../markdown/wikilink";
import { LINK } from "../markdown/link-source";
import {
  CONTEXT_CHARS,
  completionSession,
  type CaretContext,
  type CompletionSession,
} from "./completion-session";
import { completionSources, sourceTextSources } from "./sources";

const MATH_NODES = new Set(["math_inline", "math_block"]);
/** Inline nodes holding their Markdown as text: a link's target is
 *  retyped there. */
const SOURCE_NODES = new Set([LINK]);

/** What is around the caret in its paragraph or formula; null where
 *  nothing is typed. A selection in one block counts from its end: "[["
 *  typed over words wraps them, and they are what is looked for. */
function contextAt(view: EditorView): CaretContext | null {
  const { $from, $to } = view.state.selection;
  if ($from.parent !== $to.parent) return null;
  const parent = $to.parent;
  const inMath = MATH_NODES.has(parent.type.name);
  // Code is typed as it is: "/usr" or "a :b" there are no commands, only
  // what a plugin offers for code.
  const code = parent.type.name === "code_block";
  const typed = parent.isTextblock || SOURCE_NODES.has(parent.type.name);
  if (!inMath && !typed) return null;
  const at = $to.parentOffset;
  return {
    text: parent.textBetween(
      Math.max(0, at - CONTEXT_CHARS),
      at,
      undefined,
      "￼",
    ),
    after: parent.textBetween(
      at,
      Math.min(parent.content.size, at + CONTEXT_CHARS),
      undefined,
      "￼",
    ),
    inMath,
    ...(code ? { language: String(parent.attrs.language ?? "") } : {}),
    caret: $to.pos,
  };
}

/** `insert` put in over `from`-`to`, the caret at its `$0` (else its
 *  end): its own undo step, apart from the typing that called it up. */
export function pickedText(
  state: EditorState,
  insert: string,
  from: number,
  to: number,
) {
  const at = insert.indexOf("$0");
  const text = insert.replace("$0", "");
  const tr = closeHistory(state.tr).insertText(text, from, to);
  const inserted = tr.steps.length;
  wikilinksIn(tr, from, from + text.length);
  const end = tr.mapping
    .slice(inserted)
    .map(from + (at < 0 ? text.length : at));
  return tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView();
}

export function createCompletionPlugin(
  docPath: () => string | null = () => null,
) {
  return $prose(
    () =>
      new Plugin({
        view(view) {
          const session = completionSession({
            context: () => contextAt(view),
            path: docPath,
            // In a link's own text only what writes Markdown: no blocks.
            sources: () =>
              SOURCE_NODES.has(view.state.selection.$to.parent.type.name)
                ? sourceTextSources()
                : completionSources(),
            insert: (insert, from, to) =>
              view.dispatch(pickedText(view.state, insert, from, to)),
            coords: (pos) => view.coordsAtPos(pos),
            focus: () => view.focus(),
          });
          completionViews.set(view, session);
          return {
            update(view, previous) {
              if (view.composing) return;
              const docChanged = view.state.doc !== previous.doc;
              if (docChanged || !view.state.selection.eq(previous.selection))
                session.changed(docChanged);
            },
            destroy() {
              session.destroy();
              completionViews.delete(view);
            },
          };
        },
        props: {
          handleKeyDown(view, event) {
            if (
              isImeKeydown(event) ||
              event.metaKey ||
              event.ctrlKey ||
              event.altKey
            )
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
            // What an input method committed is matched once it is in.
            compositionend(view) {
              setTimeout(() => {
                if (!view.isDestroyed && !view.composing)
                  completionViews.get(view)?.refresh();
              }, 0);
              return false;
            },
          },
        },
      }),
  );
}

/** Each editor's panel, for the keys it takes while open. */
const completionViews = new WeakMap<EditorView, CompletionSession>();
