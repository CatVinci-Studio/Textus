import { openDocument } from "../../utils/open-document";
import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { fs, links } from "../../platform/ipc";
import { isScopedUrl } from "../../platform/ios-files";
import { editorExtensions } from "../extension-points";
import { modIsMeta } from "../../platform/os";
import { revealHeading } from "./heading-jump";
import { noteJump } from "../nav-history";
import { linkHrefAt } from "./link-reveal";
import { linkTarget, type LinkTarget } from "./link-target";
import { followNoteLink } from "./note-link-follow";
import { windowFolder } from "../../platform/window-folder";

/** The link under a mouse event in this editor, if any. */
function linkAt(view: EditorView, event: MouseEvent): HTMLAnchorElement | null {
  const link = (event.target as Element | null)?.closest?.("a[href]");
  return link instanceof HTMLAnchorElement && view.dom.contains(link)
    ? link
    : null;
}

/** The wikilink under a mouse event in this editor, if any. */
function wikilinkAt(view: EditorView, event: MouseEvent): HTMLElement | null {
  const link = (event.target as Element | null)?.closest?.(
    '[data-type="wikilink"]',
  );
  return link instanceof HTMLElement && view.dom.contains(link) ? link : null;
}

/** Ctrl+click, or Cmd+click where Mod is Cmd: on a Mac, Ctrl+click is the
 *  right click. */
export function isFollowClick(event: MouseEvent): boolean {
  return event.button === 0 && (modIsMeta() ? event.metaKey : event.ctrlKey);
}

async function follow(
  view: EditorView,
  href: string,
  target: LinkTarget,
  docPath: string | null,
): Promise<void> {
  if (target.kind === "heading") {
    noteJump();
    revealHeading(view, target.anchor);
    return;
  }
  if (target.kind === "web") {
    // A plugin that opens such links shows it in Textus.
    if (editorExtensions().openLink(target.url)) return;
    return links.openWebLink(target.url);
  }
  // From "/" the project's root, else the path as written; a path that
  // finds nothing goes by name (`[t](Note)`, a note in another folder).
  const fromRoot = /^\/(?!\/)/.test(href.trim());
  if (fromRoot || (await fs.fileMtimeMs(target.path)) === null)
    return followNoteLink(view, href, docPath, windowFolder());
  // A Markdown file opens in a tab; another kind in a tab too when Textus
  // shows it (a Word file, a plugin's PDF), else the app asks to open it
  // outside.
  openDocument(
    target.path,
    target.kind === "document" ? { anchor: target.anchor } : { linked: true },
  );
}

/** Follows `href` as a Ctrl/Cmd+click on it does, from the document at
 *  `docPath` (the right-click menu's Open Link). */
export function openLinkHref(
  view: EditorView,
  href: string,
  docPath: string | null,
): void {
  const local = docPath && !isScopedUrl(docPath) ? docPath : null;
  const target = linkTarget(href, local);
  if (target) void follow(view, href, target, local).catch(() => {});
}

/** The URL of the link under a mouse event: a link's own, read from its
 *  source, or a raw HTML anchor's. */
function hrefAt(view: EditorView, event: MouseEvent): string | null {
  const own = linkHrefAt(view, event.target);
  if (own !== null) return own;
  const link = linkAt(view, event);
  return link ? (link.getAttribute("href") ?? "") : null;
}

/**
 * Ctrl/Cmd+click follows links: web links to the browser (or a plugin),
 * Markdown files in a tab, other files in the file manager, `#heading`s by
 * scrolling. The webview must never follow a link itself (WebView2 opened
 * relative links as http://tauri.localhost/...), so every click's default
 * on a link is cancelled.
 */
export function createLinkClickPlugin(docPath: () => string | null) {
  return $prose(
    () =>
      new Plugin({
        props: {
          // ⌘/Ctrl-click follows a link; anywhere else it is a click, not
          // ProseMirror's own select-the-whole-block.
          handleClick: (_view, _pos, event) => isFollowClick(event),
          handleDOMEvents: {
            // The editor's own mousedown would place the caret, or with Ctrl/Cmd held
            // select the whole block, before the click.
            mousedown(view, event) {
              if (!isFollowClick(event)) return false;
              if (hrefAt(view, event) === null && !wikilinkAt(view, event))
                return false;
              event.preventDefault();
              return true;
            },
            click(view, event) {
              const doc = docPath();
              // An iOS Files document has no folder this app may read beside it.
              const local = doc && !isScopedUrl(doc) ? doc : null;
              const wikilink = wikilinkAt(view, event);
              if (wikilink && isFollowClick(event)) {
                event.preventDefault();
                const source = wikilink.textContent ?? "";
                void followNoteLink(view, source, local, windowFolder()).catch(
                  () => {},
                );
                return true;
              }
              const link = linkAt(view, event);
              if (link) event.preventDefault();
              if (!isFollowClick(event)) return false;
              const href = hrefAt(view, event);
              if (href === null) return false;
              event.preventDefault();
              const target = linkTarget(href, local);
              if (target)
                void follow(view, href, target, local).catch(() => {});
              return true;
            },
            auxclick(view, event) {
              if (linkAt(view, event)) event.preventDefault();
              return false;
            },
          },
        },
      }),
  );
}
