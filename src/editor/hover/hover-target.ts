import type { EditorView } from "@milkdown/kit/prose/view";
import { fs } from "../../platform/ipc";
import type { HoverTarget } from "../../plugins/contributions/hover-providers";
import { linkTarget } from "../markdown/link-target";
import { parseWikilink } from "../markdown/wikilink";

/** A citation as Pandoc and Zotero write it: `[@key]`, `[@key, p. 4]`,
 *  `[see @key]`, or several in one, `[@a; @b]`. */
const CITATION = /\[[^\]\n]*?@[^\]\n]*\]/g;
const CITE_KEY = /@([\w:.#$%&+?<>~/-]+)/g;

/** What the pointer is over and where it is on screen: an element (a link,
 *  a wikilink) or a run of text (a citation). */
export interface HoverSpot {
  /** What stays the same while the pointer moves within it. */
  key: string;
  rect: DOMRect;
  resolve: () => Promise<HoverTarget | null>;
}

/** The link, wikilink or citation under `event` in this editor, if any. */
export function hoverSpot(
  view: EditorView,
  event: MouseEvent,
  docPath: string | null,
): HoverSpot | null {
  const target = event.target as Element | null;
  const wikilink = target?.closest?.('[data-type="wikilink"]');
  if (wikilink instanceof HTMLElement && view.dom.contains(wikilink)) {
    const source = wikilink.textContent ?? "";
    return {
      key: `wiki:${source}`,
      rect: wikilink.getBoundingClientRect(),
      resolve: async () => {
        const parsed = parseWikilink(source);
        if (!parsed?.note || !docPath) return null;
        const path = await fs.resolveVaultNote(docPath, parsed.note);
        return path
          ? { type: "document", path, heading: parsed.heading || null }
          : null;
      },
    };
  }
  const link = target?.closest?.("a[href]");
  if (link instanceof HTMLAnchorElement && view.dom.contains(link)) {
    const href = link.getAttribute("href") ?? "";
    return {
      key: `link:${href}`,
      rect: link.getBoundingClientRect(),
      resolve: async () => linkHover(href, docPath),
    };
  }
  return citationAt(view, event);
}

function linkHover(href: string, docPath: string | null): HoverTarget | null {
  const target = linkTarget(href, docPath);
  if (target?.kind === "document")
    return {
      type: "document",
      path: target.path,
      heading: target.anchor ?? null,
    };
  if (target?.kind === "heading" || target?.kind === "file") return null;
  // The web, and other apps' links (zotero://select/...).
  return /^[a-z][a-z0-9+.-]*:/i.test(href.trim())
    ? { type: "link", url: href.trim() }
    : null;
}

/** The citation key under the pointer, in a `[@key]` of the text. */
function citationAt(view: EditorView, event: MouseEvent): HoverSpot | null {
  const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!at || at.inside < 0) return null;
  const $pos = view.state.doc.resolve(at.pos);
  if (!$pos.parent.isTextblock) return null;
  const text = $pos.parent.textContent;
  const offset = $pos.parentOffset;
  for (const group of text.matchAll(CITATION)) {
    const start = group.index;
    if (offset < start || offset > start + group[0].length) continue;
    const cites = [...group[0].matchAll(CITE_KEY)];
    if (cites.length === 0) continue;
    // The key the pointer is on; on the brackets or a word around them,
    // the first.
    const cite =
      cites.find(
        (c) =>
          offset >= start + c.index && offset <= start + c.index + c[0].length,
      ) ?? cites[0];
    const key = cite[1].replace(/[.,;:]+$/, "");
    const base = $pos.start();
    const a = view.coordsAtPos(base + start);
    const b = view.coordsAtPos(base + start + group[0].length);
    return {
      key: `cite:${key}`,
      rect: new DOMRect(a.left, a.top, b.right - a.left, a.bottom - a.top),
      resolve: async () => ({ type: "citation", key }),
    };
  }
  return null;
}
