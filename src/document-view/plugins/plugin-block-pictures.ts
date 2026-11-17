import { webviewPicture } from "../../plugins/views/webviews";

/** How long an export waits for a drawing just made to have its page. */
const PAGE_WAIT_MS = 5000;

/** An export's way to the drawings' pictures (`selector`), each asked of
 *  its plugin's page; a source shown is `hiddenSource` while hidden. */
export const drawnBlocks = (selector: string, hiddenSource: string) => ({
  selector,
  hiddenSource,
  language: (el: HTMLElement) => el.dataset.language ?? "",
  async picture(el: HTMLElement, theme: "light" | "dark") {
    const page = await pageIn(el);
    return page ? webviewPicture(page, theme) : null;
  },
});

/** The webview drawn in `el`: there once its plugin has made it. */
function pageIn(el: HTMLElement): Promise<string | null> {
  const find = () =>
    el.querySelector<HTMLElement>("[data-webview-id]")?.dataset.webviewId ??
    null;
  const now = find();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = (id: string | null) => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(id);
    };
    const observer = new MutationObserver(() => {
      const id = find();
      if (id) done(id);
    });
    observer.observe(el, { childList: true, subtree: true });
    const timer = setTimeout(() => done(null), PAGE_WAIT_MS);
  });
}
