import { currentStrings } from "../../i18n/current";
import { keepInList, uiList } from "../../storage/ui-state";
import "./block-fold.css";

/**
 * One way to fold a block that is drawn rather than typed - an embedded
 * note, a plugin's block: a caret in the margin on its left, shown on hover,
 * and, folded, a single line with the block's name. Which ones are folded is
 * kept on this machine, by the document and the block's place in it.
 */

/** Folds remembered at most; the oldest goes first. */
const KEPT = 300;

const kept = uiList;

function keep(
  name: "foldedBlocks" | "openedBlocks",
  key: string,
  on: boolean,
): void {
  keepInList(name, key, on, { max: KEPT });
}

function blockFolded(key: string): boolean {
  return kept("foldedBlocks").includes(key);
}

/** Folded or opened by the user, kept; an opened one is remembered too, so
 *  a block that starts folded in a narrow column stays open once opened. */
function setBlockFolded(key: string, on: boolean): void {
  keep("foldedBlocks", key, on);
  keep("openedBlocks", key, !on);
}

const caretSpan = () =>
  Object.assign(document.createElement("span"), {
    className: "disclosure-caret",
  });

/** Puts the fold's caret and folded line at the start of `el`, for `name`;
 *  `key` rides on the caret (data-key), so markup kept as HTML keeps it. */
export function addBlockFoldMarkup(
  el: HTMLElement,
  name: string,
  key: string,
): void {
  el.classList.add("block-foldable");
  const caret = document.createElement("button");
  caret.type = "button";
  caret.className = "tx-reveal block-fold";
  caret.dataset.key = key;
  caret.append(caretSpan());
  const line = document.createElement("button");
  line.type = "button";
  line.className = "block-folded-line";
  line.append(
    caretSpan(),
    Object.assign(document.createElement("span"), {
      className: "block-folded-name",
      textContent: name,
    }),
  );
  el.prepend(caret, line);
}

/** Shows `el` folded to its line, or whole, its buttons saying which. */
export function showBlockFold(el: HTMLElement, folded: boolean): void {
  el.toggleAttribute("data-folded", folded);
  const caret = el.querySelector<HTMLElement>(":scope > .block-fold");
  const line = el.querySelector<HTMLElement>(":scope > .block-folded-line");
  const name =
    line?.querySelector(".block-folded-name")?.textContent ??
    line?.textContent ??
    "";
  const t = currentStrings();
  caret?.setAttribute("aria-expanded", String(!folded));
  caret?.setAttribute(
    "aria-label",
    `${folded ? t.outlineExpand : t.outlineCollapse}: ${name}`,
  );
  line?.setAttribute("aria-hidden", String(!folded));
  line?.setAttribute("aria-label", `${t.outlineExpand}: ${name}`);
}

/** The fold's key, if `target` is one of `el`'s fold buttons. */
export function foldButtonKey(target: EventTarget | null): string | null {
  const button = (target as Element | null)?.closest?.(
    ".block-fold, .block-folded-line",
  );
  const el = button?.parentElement;
  return (
    el?.querySelector<HTMLElement>(":scope > .block-fold")?.dataset.key ?? null
  );
}

/** Gives `el` its fold, kept by `key` (blockFolded), and wires its buttons:
 *  for blocks drawn fresh each time, not restored from HTML. */
export function addBlockFold(
  el: HTMLElement,
  name: string,
  key: string,
  /** Starts folded unless the user opened it: a wide block in a narrow column. */
  foldUnlessOpened = false,
): void {
  addBlockFoldMarkup(el, name, key);
  const toggle = (event: Event) => {
    // Not a click in the document: the caret stays where it was.
    event.preventDefault();
    event.stopPropagation();
    const on = !el.hasAttribute("data-folded");
    setBlockFolded(key, on);
    showBlockFold(el, on);
  };
  for (const button of el.querySelectorAll(
    ":scope > .block-fold, :scope > .block-folded-line",
  )) {
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", toggle);
  }
  showBlockFold(
    el,
    blockFolded(key) ||
      (foldUnlessOpened && !kept("openedBlocks").includes(key)),
  );
}
