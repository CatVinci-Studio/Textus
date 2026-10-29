import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { exportDoc, fs, links } from "../../platform/ipc";
import { isScopedUrl } from "../../platform/ios-files";
import { editorExtensions } from "../extension-points";
import { modIsMeta } from "../../platform/os";
import { OPEN_FILE_IN_TAB_EVENT, type OpenFileInTab } from "../../utils/events";
import { revealHeading } from "./heading-jump";
import { noteJump } from "../../utils/nav-history";
import { revealedLinkHref } from "./link-reveal";
import { linkTarget, type LinkTarget } from "./link-target";
import { parseWikilink } from "./wikilink";

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
function isFollowClick(event: MouseEvent): boolean {
  return event.button === 0 && (modIsMeta() ? event.metaKey : event.ctrlKey);
}

async function follow(view: EditorView, target: LinkTarget): Promise<void> {
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
  // A link to a file that isn't there opens nothing.
  if ((await fs.fileMtimeMs(target.path)) === null) return;
  if (target.kind === "document")
    window.dispatchEvent(
      new CustomEvent<OpenFileInTab>(OPEN_FILE_IN_TAB_EVENT, {
        detail: { path: target.path, anchor: target.anchor },
      }),
    );
  // Shown, not opened: the system would run a linked program as readily as it
  // shows a PDF.
  else return exportDoc.revealInDir(target.path);
}

/** A wikilink: `[[#Heading]]` scrolls here, `[[Note]]` opens the vault's
 *  note by that name, `[[Note#Heading]]` at that heading. */
async function followWikilink(
  view: EditorView,
  source: string,
  docPath: string | null,
): Promise<void> {
  const target = parseWikilink(source);
  if (!target) return;
  if (!target.note) {
    if (target.heading) {
      noteJump();
      revealHeading(view, target.heading);
    }
    return;
  }
  if (!docPath) return;
  const path = await fs.resolveVaultNote(docPath, target.note);
  if (path)
    window.dispatchEvent(
      new CustomEvent<OpenFileInTab>(OPEN_FILE_IN_TAB_EVENT, {
        detail: { path, anchor: target.heading || undefined },
      }),
    );
}

/** The URL of the link under a mouse event, or of one the caret shows as
 *  its source. */
function hrefAt(view: EditorView, event: MouseEvent): string | null {
  const link = linkAt(view, event);
  if (link) return link.getAttribute("href") ?? "";
  return revealedLinkHref(view, event.target);
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
              const folder = doc && !isScopedUrl(doc) ? doc : null;
              const wikilink = wikilinkAt(view, event);
              if (wikilink && isFollowClick(event)) {
                event.preventDefault();
                const source = wikilink.textContent ?? "";
                void followWikilink(view, source, folder).catch(() => {});
                return true;
              }
              const link = linkAt(view, event);
              if (link) event.preventDefault();
              if (!isFollowClick(event)) return false;
              const href = hrefAt(view, event);
              if (href === null) return false;
              event.preventDefault();
              const target = linkTarget(href, folder);
              if (target) void follow(view, target).catch(() => {});
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
