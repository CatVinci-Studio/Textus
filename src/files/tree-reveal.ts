/** How long a row just made has to be drawn before it is given up: its
 *  folder reads its entries again first. */
const WAIT_MS = 2000;

/** Scrolls the row of `path` into view in the tree `tree` once it is
 *  drawn, as its folder reads its entries again after a change; `focus`
 *  gives it the keyboard too. */
export function scrollRowIntoView(
  tree: HTMLElement | null,
  path: string,
  focus = false,
) {
  if (!tree) return;
  const find = () =>
    [...tree.querySelectorAll<HTMLElement>("[data-path]")].find(
      (el) => el.dataset.path === path,
    );
  const show = (row: HTMLElement) => {
    row.scrollIntoView({ block: "nearest" });
    if (focus) row.focus({ preventScroll: true });
  };
  const now = find();
  if (now) return show(now);
  const watch = new MutationObserver(() => {
    const row = find();
    if (!row) return;
    stop();
    show(row);
  });
  const timer = window.setTimeout(() => stop(), WAIT_MS);
  const stop = () => {
    watch.disconnect();
    window.clearTimeout(timer);
  };
  watch.observe(tree, { childList: true, subtree: true });
}

/** The keyboard kept in the tree `tree` after its rows changed under it
 *  (a move, an undo): on the row of `path` once drawn, and meanwhile on the
 *  row in the tab order, so the next key still reaches the tree, not the
 *  document. */
export function keepKeyboardOn(tree: HTMLElement | null, path: string | null) {
  if (!tree) return;
  if (!tree.contains(document.activeElement))
    (
      tree.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]') ??
      tree.querySelector<HTMLElement>('[role="treeitem"]')
    )?.focus({ preventScroll: true });
  if (path) scrollRowIntoView(tree, path, true);
}

/** The row shown next to the rows of `paths`, which are about to go: the
 *  first after them, else the last before, as a file manager picks after a
 *  delete. Null when none is drawn. */
export function rowBeside(
  tree: HTMLElement | null,
  paths: readonly string[],
): string | null {
  if (!tree) return null;
  const going = (p: string) =>
    paths.some((gone) => p === gone || p.startsWith(`${gone}/`));
  const rows = [
    ...tree.querySelectorAll<HTMLElement>('[role="treeitem"][data-path]'),
  ].filter((el) => el.getClientRects().length > 0);
  const first = rows.findIndex((el) => going(el.dataset.path!));
  if (first === -1) return null;
  const after = rows.slice(first).find((el) => !going(el.dataset.path!));
  const before = rows
    .slice(0, first)
    .reverse()
    .find((el) => !going(el.dataset.path!));
  return (after ?? before)?.dataset.path ?? null;
}
