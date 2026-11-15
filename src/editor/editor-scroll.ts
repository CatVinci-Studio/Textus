import { isPhoneLayout } from "../platform/phone-layout";

/**
 * Where the caret's line is kept when the view brings it into sight: below
 * where the page's text starts (clear of the format bar over it), and on a
 * phone above the format bar riding on the keyboard, a line under that bar
 * counting as out of view.
 */
export function scrollOptions(root: HTMLElement) {
  return {
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
