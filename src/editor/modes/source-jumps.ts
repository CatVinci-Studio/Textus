import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { headingsOf } from "../../utils/markdown-headings";
import { onTabJump, peekTabJump, takeTabJump } from "../tab-jump";
import { mayTakeKeys } from "../take-keys";

// Source mode has no rich editor to take the outline's jumps, so a row did
// nothing there, and the jump waited to fire on the next switch back. The
// outline's index is the scan's, so its line is the heading's own.

/** Puts the caret at the end of the `index`-th top-level heading of
 *  `view`'s text, its line at the top; with `select`, selects its section:
 *  the heading up to the next at its level or above. */
function revealSourceHeading(
  view: EditorView,
  index: number,
  select = false,
): boolean {
  const { doc } = view.state;
  const headings = headingsOf(doc.toString());
  const heading = headings[index];
  if (!heading) return false;
  const start = doc.line(heading.line + 1).from;
  // A setext heading's text ends on the line above its underline.
  const textEnd = heading.end > heading.line ? heading.end : heading.line + 1;
  const next = headings.slice(index + 1).find((h) => h.level <= heading.level);
  const selection = select
    ? EditorSelection.range(start, next ? doc.line(next.line).to : doc.length)
    : EditorSelection.cursor(doc.line(textEnd).to);
  view.dispatch({
    selection,
    effects: EditorView.scrollIntoView(start, { y: "start" }),
  });
  if (mayTakeKeys()) view.focus();
  return true;
}

/** Takes the outline's jumps to `tabId` while its source view shows;
 *  any other jump is left for the rich editor. Returns the unsubscribe. */
export function followOutlineJumps(tabId: string, view: EditorView) {
  return onTabJump((id) => {
    const jump = id === tabId ? peekTabJump(tabId) : null;
    if (jump?.kind !== "outline") return;
    takeTabJump(tabId);
    revealSourceHeading(view, jump.index, jump.select);
  });
}
