import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { isImeKeyEvent } from "../marks/enclosure";

/** The leading spaces/tabs of the last line in `textBeforeCursor`. */
export function leadingWhitespaceOfLastLine(textBeforeCursor: string): string {
  const lastNewline = textBeforeCursor.lastIndexOf("\n");
  const lastLine = textBeforeCursor.slice(lastNewline + 1);
  return lastLine.match(/^[ \t]*/)?.[0] ?? "";
}

/**
 * Enter inside a code block carries the current line's indentation onto the
 * new one. Registered after the escape-trailing-block plugin, which gets
 * first refusal on an Enter that leaves the last code block.
 */
export const codeBlockIndentPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (event.key !== "Enter" || event.shiftKey) return false;
          if (isImeKeyEvent(view, event)) return false;

          const { state } = view;
          const { $from, empty } = state.selection;
          if (!empty || $from.parent.type.name !== "code_block") return false;

          const textBeforeCursor = $from.parent.textBetween(
            0,
            $from.parentOffset,
            "\n",
          );
          const indent = leadingWhitespaceOfLastLine(textBeforeCursor);
          if (!indent) return false;

          view.dispatch(state.tr.insertText("\n" + indent).scrollIntoView());
          return true;
        },
      },
    }),
);
