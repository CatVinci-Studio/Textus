import type { EditorView } from "@milkdown/kit/prose/view";
import { fs } from "../../platform/ipc";
import type { HoverTarget } from "../extension-points";
import { linkHrefAt } from "../markdown/link-reveal";
import { linkTarget } from "../markdown/link-target";
import { parseNoteLink } from "../../utils/note-link";
import { windowFolder } from "../../platform/window-folder";
import { zoomedRectScale } from "../../ui/zoomed-rects";

/** A citation as Pandoc and Zotero write it: `[@key]`, `[@key, p. 4]`,
 *  `[see @key]`, or several in one, `[@a; @b]`. */
const CITATION = /\[[^\]\n]*?@[^\]\n]*\]/g;
const CITE_KEY = /@([\w:.#$%&+?<>~/-]+)/g;

/** What the pointer is over and where it is on screen. */
export interface HoverSpot {
  /** What stays the same while the pointer moves within it. */
  key: string;
  /** As drawn on screen, inside the document's zoom or not. */
  rect: DOMRect;
  resolve: () => Promise<HoverTarget | null>;
}

/** The link, wikilink or citation under `event` in this editor, if any. */
export function hoverSpot(
  view: EditorView,
  event: MouseEvent,
  docPath: string | null,
): HoverSpot | null {
  const spot = spotAt(view, event, docPath);
  if (!spot) return null;
  const scale = zoomedRectScale(view.dom);
  if (scale === 1) return spot;
  const { left, top, width, height } = spot.rect;
  return {
    ...spot,
    rect: new DOMRect(left * scale, top * scale, width * scale, height * scale),
  };
}

function spotAt(
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
        const parsed = parseNoteLink(source);
        if (!parsed?.note || !docPath) return null;
        const found = await fs.resolveNoteLink(
          docPath,
          parsed.note,
          windowFolder(),
          true,
        );
        // A ^id is a block, never a heading's name.
        const heading = parsed.block ? null : (parsed.headings.at(-1) ?? null);
        return found?.exists
          ? { type: "document", path: found.path, heading, block: parsed.block }
          : null;
      },
    };
  }
  const link = target?.closest?.("a[href], a[data-type]");
  const href =
    linkHrefAt(view, target) ??
    (link instanceof HTMLAnchorElement ? link.getAttribute("href") : null);
  if (link instanceof HTMLAnchorElement && view.dom.contains(link) && href) {
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
      heading: target.anchor?.startsWith("^") ? null : (target.anchor ?? null),
      block: target.anchor?.startsWith("^") ? target.anchor.slice(1) : null,
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
    // The key the pointer is on, else the first.
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
