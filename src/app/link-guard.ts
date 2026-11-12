import { links } from "../platform/ipc";

/**
 * The window never follows a link itself: a web link anywhere in it (an AI
 * reply, a note, a plugin's readme) opens in the browser, and any other is
 * left to what drew it. Bubble phase, so the editor's and a list's own link
 * handling come first.
 */
export function installLinkGuard(): void {
  const follow = (event: MouseEvent) => {
    const target = event.target;
    const link = target instanceof Element && target.closest("a[href]");
    if (!(link instanceof HTMLAnchorElement) || event.defaultPrevented) return;
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("#") || link.hasAttribute("download")) return;
    event.preventDefault();
    if (/^https?:/i.test(link.href)) void links.openWebLink(link.href);
  };
  window.addEventListener("click", follow);
  window.addEventListener("auxclick", follow);
}
