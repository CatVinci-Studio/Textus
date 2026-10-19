import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { exportDoc, fs, links } from "../../platform/ipc";
import { isScopedUrl } from "../../platform/ios-files";
import { modIsMeta } from "../../platform/os";
import { OPEN_FILE_IN_TAB_EVENT } from "../../utils/events";
import { unfoldRange } from "../html/details-fold";
import { revealPosition } from "../reveal-position";
import { headingSlug, linkTarget, type LinkTarget } from "./link-target";
import { parseWikilink } from "./wikilink";

/** The link under a mouse event in this editor, if any. */
function linkAt(view: EditorView, event: MouseEvent): HTMLAnchorElement | null {
  const link = (event.target as Element | null)?.closest?.("a[href]");
  return link instanceof HTMLAnchorElement && view.dom.contains(link)
    ? link
    : null;
}

/** The wikilink (wikilink.ts) under a mouse event in this editor, if any. */
function wikilinkAt(view: EditorView, event: MouseEvent): HTMLElement | null {
  const link = (event.target as Element | null)?.closest?.(
    '[data-type="wikilink"]',
  );
  return link instanceof HTMLElement && view.dom.contains(link) ? link : null;
}

/** Ctrl+click, or Cmd+click where Mod is Cmd (a Mac, an iPad's keyboard) -
 *  on a Mac, Ctrl+click is the right click. */
function isFollowClick(event: MouseEvent): boolean {
  return event.button === 0 && (modIsMeta() ? event.metaKey : event.ctrlKey);
}

/** The position inside the heading `anchor` names, numbering repeats the
 *  way GitHub does ("intro", "intro-1"), or null. */
function headingPos(view: EditorView, anchor: string): number | null {
  const wanted = headingSlug(anchor);
  const seen = new Map<string, number>();
  let found: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name !== "heading") return true;
    const slug = headingSlug(node.textContent);
    const repeat = seen.get(slug) ?? 0;
    seen.set(slug, repeat + 1);
    if ((repeat ? `${slug}-${repeat}` : slug) === wanted) found = pos + 1;
    return false;
  });
  return found;
}

/** Scrolls to the heading `anchor` names in this document. */
function revealHeading(view: EditorView, anchor: string): void {
  const pos = headingPos(view, anchor);
  if (pos === null) return;
  // A heading in a folded <details> has no place on screen to scroll to
  // until its fold opens.
  unfoldRange(view, pos);
  revealPosition(view, pos);
}

async function follow(view: EditorView, target: LinkTarget): Promise<void> {
  if (target.kind === "heading") return revealHeading(view, target.anchor);
  if (target.kind === "web") return links.openWebLink(target.url);
  // A link to a file that isn't there opens nothing.
  if ((await fs.fileMtimeMs(target.path)) === null) return;
  if (target.kind === "document")
    window.dispatchEvent(
      new CustomEvent(OPEN_FILE_IN_TAB_EVENT, { detail: target.path }),
    );
  // Shown, not opened: opening hands the file to the system, which runs a
  // linked program or script as readily as it shows a PDF.
  else return exportDoc.revealInDir(target.path);
}

/** A wikilink: `[[#Heading]]` scrolls to a heading here, `[[Note]]` opens
 *  the note the document's vault holds by that name (at its top - a
 *  `#heading` in another note isn't reached). */
async function followWikilink(
  view: EditorView,
  source: string,
  docPath: string | null,
): Promise<void> {
  const target = parseWikilink(source);
  if (!target) return;
  if (!target.note) {
    if (target.heading) revealHeading(view, target.heading);
    return;
  }
  if (!docPath) return;
  const path = await fs.resolveVaultNote(docPath, target.note);
  if (path)
    window.dispatchEvent(
      new CustomEvent(OPEN_FILE_IN_TAB_EVENT, { detail: path }),
    );
}

/**
 * Following links: Ctrl/Cmd+click opens a web link in the browser, a
 * Markdown file in a tab, any other file in the file manager, and scrolls
 * to a `#heading` of this document; on a wikilink it opens the note. A
 * plain click only places the caret.
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
              if (!isFollowClick(event)) return false;
              if (!linkAt(view, event) && !wikilinkAt(view, event))
                return false;
              event.preventDefault();
              return true;
            },
            click(view, event) {
              const doc = docPath();
              // A document picked in iOS Files is a scoped URL with no
              // folder this app may read beside it.
              const folder = doc && !isScopedUrl(doc) ? doc : null;
              const wikilink = wikilinkAt(view, event);
              if (wikilink && isFollowClick(event)) {
                event.preventDefault();
                const source = wikilink.textContent ?? "";
                void followWikilink(view, source, folder).catch(() => {});
                return true;
              }
              const link = linkAt(view, event);
              if (!link) return false;
              event.preventDefault();
              if (!isFollowClick(event)) return false;
              const target = linkTarget(
                link.getAttribute("href") ?? "",
                folder,
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
