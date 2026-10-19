import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { exportDoc, fs, links } from "../../platform/ipc";
import { isScopedUrl } from "../../platform/ios-files";
import { modIsMeta } from "../../platform/os";
import { OPEN_FILE_IN_TAB_EVENT, type OpenFileInTab } from "../../utils/events";
import { revealHeading } from "./heading-jump";
import { linkTarget, type LinkTarget } from "./link-target";

/** The link under a mouse event in this editor, if any. */
function linkAt(view: EditorView, event: MouseEvent): HTMLAnchorElement | null {
  const link = (event.target as Element | null)?.closest?.("a[href]");
  return link instanceof HTMLAnchorElement && view.dom.contains(link)
    ? link
    : null;
}

/** Ctrl+click, or Cmd+click where Mod is Cmd (a Mac, an iPad's keyboard) -
 *  on a Mac, Ctrl+click is the right click. */
function isFollowClick(event: MouseEvent): boolean {
  return event.button === 0 && (modIsMeta() ? event.metaKey : event.ctrlKey);
}

async function follow(view: EditorView, target: LinkTarget): Promise<void> {
  if (target.kind === "heading") {
    revealHeading(view, target.anchor);
    return;
  }
  if (target.kind === "web") return links.openWebLink(target.url);
  // A link to a file that isn't there opens nothing.
  if ((await fs.fileMtimeMs(target.path)) === null) return;
  if (target.kind === "document")
    window.dispatchEvent(
      new CustomEvent<OpenFileInTab>(OPEN_FILE_IN_TAB_EVENT, {
        detail: { path: target.path, anchor: target.anchor },
      }),
    );
  // Shown, not opened: opening hands the file to the system, which runs a
  // linked program or script as readily as it shows a PDF.
  else return exportDoc.revealInDir(target.path);
}

/**
 * Following links: Ctrl/Cmd+click opens a web link in the browser, a
 * Markdown file in a tab (scrolled to its `#heading`, if the link names
 * one), any other file in the file manager, and scrolls to a `#heading` of
 * this document. A plain click only places the caret.
 *
 * The webview must never follow a link itself: WebView2 opened a
 * Ctrl+clicked relative link in the browser as http://tauri.localhost/...
 * (#152), and a plain click on a link in a raw HTML preview (not editable)
 * would navigate the window away from the app. So every click and middle
 * click on a link has its default cancelled.
 */
export function createLinkClickPlugin(docPath: () => string | null) {
  return $prose(
    () =>
      new Plugin({
        props: {
          handleDOMEvents: {
            // The editor's own mousedown would place the caret, or with
            // Ctrl/Cmd held select the whole block, before the click.
            mousedown(view, event) {
              if (!isFollowClick(event) || !linkAt(view, event)) return false;
              event.preventDefault();
              return true;
            },
            click(view, event) {
              const link = linkAt(view, event);
              if (!link) return false;
              event.preventDefault();
              if (!isFollowClick(event)) return false;
              const doc = docPath();
              // A document picked in iOS Files is a scoped URL with no
              // folder this app may read beside it.
              const target = linkTarget(
                link.getAttribute("href") ?? "",
                doc && !isScopedUrl(doc) ? doc : null,
              );
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
