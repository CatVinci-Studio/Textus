import { fs } from "../../platform/ipc";
import { embedFolded } from "./embed-folds";
import { currentStrings } from "../../i18n/current";
import {
  parseNoteLink,
  type NoteLink,
  WIKILINK_SOURCE,
} from "../../utils/note-link";
import { basename, isNoteFile, noteStem } from "../../utils/path";
import { showDocImage } from "../images/image-plugin";
import { renderDocumentHtml } from "../markdown/render-html";
import { embedProvider, type EmbedKind } from "./embed-sources";
import { drawEmbeddedBlocks } from "./embed-plugin-blocks";

/**
 * A note's, a section's or a block's `![[embed]]`, drawn read-only from what
 * the plugin that owns its kind gives. Embeds inside are drawn the same way,
 * at most MAX_DEPTH deep and never one already on the way down: those, and
 * anything that can't be drawn, show as a chip with the link's name.
 */

export const MAX_DEPTH = 5;
const ANSWER_MS = 3000;
/** `![[x.pdf]]`, `![[pic.png]]`: files, not notes ("v1.2" is a note). */
const OTHER_FILE = /\.(?!md$|markdown$)[a-z][a-z0-9]{1,4}$/i;
const EMBED = new RegExp(`!${WIKILINK_SOURCE}`, "g");
const WIKILINK = new RegExp(`(?<!!)${WIKILINK_SOURCE}`, "g");

export interface EmbedPlace {
  /** The document the embed is written in. */
  docPath: string;
  folder: string | null;
  /** 1 for an embed in the document itself. */
  depth: number;
  /** The parts shown on the way down, as `embedKey`s. */
  chain: readonly string[];
  signal: AbortSignal;
  /** Each note an embed was read from, so its saves redraw it. */
  read: (path: string) => void;
}

/** A note embed's link, or null for a picture's or another file's. */
export function noteEmbedOf(source: string): NoteLink | null {
  const link = parseNoteLink(source);
  if (!link?.embed || OTHER_FILE.test(link.note)) return null;
  return link;
}

export const embedKind = (link: NoteLink): EmbedKind =>
  link.block ? "block" : link.headings.length ? "heading" : "note";

/** What a part of a note is known by, for the cycle guard. */
export const embedKey = (path: string, heading = "", block = "") =>
  [path.toLowerCase(), heading.toLowerCase(), block].join("\n");

/** The link's name as a chip shows it: "Note › Heading". */
function nameOf(link: NoteLink, path: string): string {
  const note = link.note || noteStem(basename(path));
  const part = link.block ? `^${link.block}` : link.headings.at(-1);
  return link.alias || (part ? `${note} › ${part}` : note);
}

function chip(el: HTMLElement, text: string, missing: boolean): void {
  el.className = `note-embed-chip${missing ? " wikilink-missing" : ""}`;
  el.textContent = text;
}

function withTimeout<T>(promise: Promise<T>, signal: AbortSignal) {
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), ANSWER_MS);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve(null);
      });
    }),
  ]);
}

/** Text nodes of `root` outside code, where `[[...]]` is no link. */
function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode())
    if (!n.parentElement?.closest("pre, code")) found.push(n as Text);
  return found;
}

/** Each match of `pattern` in `root`'s text replaced by `make(match)`. */
function replaceText(
  root: HTMLElement,
  pattern: RegExp,
  make: (source: string) => HTMLElement,
): HTMLElement[] {
  const made: HTMLElement[] = [];
  for (const node of textNodes(root)) {
    const text = node.data;
    const parts: (string | HTMLElement)[] = [];
    let last = 0;
    for (const m of text.matchAll(pattern)) {
      parts.push(text.slice(last, m.index));
      const el = make(m[0]);
      made.push(el);
      parts.push(el);
      last = m.index + m[0].length;
    }
    if (!parts.length) continue;
    parts.push(text.slice(last));
    node.replaceWith(...parts);
  }
  return made;
}

/** Draws the embed `link` into `el`, asking its kind's owner. */
export async function fillEmbed(
  el: HTMLElement,
  link: NoteLink,
  place: EmbedPlace,
): Promise<void> {
  const provider = embedProvider(embedKind(link));
  const found = link.note
    ? await fs
        .resolveNoteLink(place.docPath, link.note, place.folder, true)
        .catch(() => null)
    : { path: place.docPath, exists: true };
  if (place.signal.aborted) return;
  if (!found?.exists || !isNoteFile(found.path) || !provider)
    return chip(el, nameOf(link, place.docPath), !found?.exists);
  place.read(found.path);
  const heading = link.headings.at(-1);
  const key = embedKey(found.path, heading, link.block ?? "");
  const name = nameOf(link, found.path);
  if (place.depth > MAX_DEPTH || place.chain.includes(key))
    return chip(el, name, false);
  const controller = new AbortController();
  place.signal.addEventListener("abort", () => controller.abort());
  const content = await withTimeout(
    provider.provide(
      {
        path: found.path,
        ...(heading ? { heading } : {}),
        ...(link.block ? { block: link.block } : {}),
        ...(link.alias ? { alias: link.alias } : {}),
      },
      controller.signal,
    ),
    controller.signal,
  );
  controller.abort();
  if (place.signal.aborted) return;
  if (!content) return chip(el, name, true);

  const title = document.createElement("span");
  title.className = "note-embed-title";
  const foldKey = `${place.docPath}\n${found.path}#${heading ?? ""}^${link.block ?? ""}`;
  const fold = document.createElement("span");
  fold.className = "note-embed-fold";
  fold.setAttribute("role", "button");
  fold.tabIndex = 0;
  fold.dataset.key = foldKey;
  fold.append(
    Object.assign(document.createElement("span"), {
      className: "disclosure-caret",
    }),
  );
  const named = document.createElement("span");
  named.textContent = content.title || name;
  title.append(fold, named);
  const body = document.createElement("span");
  body.className = "note-embed-body";
  body.innerHTML = renderDocumentHtml(content.markdown);
  for (const img of body.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (src) showDocImage(img, src, found.path);
  }
  drawEmbeddedBlocks(body, found.path, place.signal);
  replaceText(body, WIKILINK, (source) => {
    const span = document.createElement("span");
    span.className = "wikilink";
    span.dataset.type = "wikilink";
    span.textContent = source;
    return span;
  });
  const nested = replaceText(body, EMBED, (source) => {
    const span = document.createElement("span");
    span.dataset.source = source;
    return span;
  });
  el.className = "note-embed";
  el.dataset.path = found.path;
  el.dataset.anchor = link.block ? `^${link.block}` : (heading ?? "");
  el.replaceChildren(title, body);
  setFolded(el, embedFolded(foldKey));
  const below = {
    ...place,
    docPath: found.path,
    depth: place.depth + 1,
    chain: [...place.chain, key],
  };
  await Promise.all(
    nested.map((span) => {
      const inner = noteEmbedOf(span.dataset.source ?? "");
      if (!inner) {
        chip(span, span.dataset.source ?? "", false);
        return null;
      }
      span.className = "note-embed";
      return fillEmbed(span, inner, below);
    }),
  );
}

/** Shows `el`'s body or folds it under its title, the toggle saying which. */
export function setFolded(el: HTMLElement, folded: boolean): void {
  if (folded) el.dataset.folded = "";
  else delete el.dataset.folded;
  const fold = el.querySelector<HTMLElement>(
    ":scope > .note-embed-title > .note-embed-fold",
  );
  if (!fold) return;
  const t = currentStrings();
  fold.setAttribute("aria-expanded", String(!folded));
  fold.setAttribute("aria-label", folded ? t.outlineExpand : t.outlineCollapse);
}
