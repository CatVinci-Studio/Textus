import type { EditorView } from "@milkdown/kit/prose/view";
import { isPhoneLayout } from "../platform/phone-layout";

/**
 * Where the caret's line is kept when the view brings it into sight: below
 * where the page's text starts (clear of the format bar over it), and on a
 * phone above the format bar riding on the keyboard, a line under that bar
 * counting as out of view.
 */
export function scrollOptions(root: HTMLElement) {
  return {
    handleScrollToSelection: scrollOnlyWhenAsked,
    scrollMargin: {
      get top() {
        const page = root.closest(".editor-content");
        return page ? parseFloat(getComputedStyle(page).paddingTop) || 5 : 5;
      },
      right: 5,
      get bottom() {
        return footRoom(root);
      },
      left: 5,
    },
    scrollThreshold: {
      top: 0,
      right: 0,
      get bottom() {
        return footRoom(root) - 5;
      },
      left: 0,
    },
  };
}

/** The room the phone's format bar takes at the page's foot. */
function footRoom(root: HTMLElement): number {
  if (!document.documentElement.classList.contains("keyboard-up")) return 5;
  const bar = root
    .closest(".split-pane")
    ?.querySelector<HTMLElement>(":scope > .format-bar");
  return isPhoneLayout() && bar ? bar.offsetHeight + 8 : 5;
}

const scrolled = new WeakMap<EditorView, number>();

/**
 * The view goes to its caret when an edit asks it to (scrollIntoView), not
 * when the editor merely takes the focus: ProseMirror, finding the caret
 * the browser left at the document's start as focus came, puts its own back
 * and scrolls to it - away from where the page was being read.
 */
function scrollOnlyWhenAsked(view: EditorView): boolean {
  // Counted by the state: one more for each transaction that asked.
  const asked =
    (view.state as { scrollToSelection?: number }).scrollToSelection ?? 0;
  if (asked === (scrolled.get(view) ?? 0)) return true;
  scrolled.set(view, asked);
  return false;
}
