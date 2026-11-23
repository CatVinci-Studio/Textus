/** How long a row just made has to be drawn before it is given up: its
 *  folder reads its entries again first. */
const WAIT_MS = 2000;

/** Scrolls the row of `path` into view in the tree `tree` once it is
 *  drawn, as its folder reads its entries again after a change. */
export function scrollRowIntoView(tree: HTMLElement | null, path: string) {
  if (!tree) return;
  const find = () =>
    [...tree.querySelectorAll<HTMLElement>("[data-path]")].find(
      (el) => el.dataset.path === path,
    );
  const show = (row: HTMLElement) => row.scrollIntoView({ block: "nearest" });
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
