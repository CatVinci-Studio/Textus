import { addBlockFoldMarkup, showBlockFold } from "../fold/block-fold";
import { fs } from "../../platform/ipc";
import { embedFolded } from "./embed-folds";
import { currentStrings } from "../../i18n/current";
import {
  parseNoteLink,
  type NoteLink,
} from "../../utils/note-link";
import { basename, isNoteFile, noteStem } from "../../utils/path";
import { drawPreview, type PreviewHandle } from "../preview-editor";
import { embedProvider, type EmbedKind } from "./embed-sources";

/**
 * A note's, a section's or a block's `![[embed]]`, drawn read-only from what
 * the plugin that owns its kind gives. Embeds inside are drawn the same way,
 * at most MAX_DEPTH deep and never one already on the way down: those, and
 * anything that can't be drawn, show as a chip with the link's name.
 */

const MAX_DEPTH = 5;
const ANSWER_MS = 3000;
/** `![[x.pdf]]`, `![[pic.png]]`: files, not notes ("v1.2" is a note). */
const OTHER_FILE = /\.(?!md$|markdown$)[a-z][a-z0-9]{1,4}$/i;

interface EmbedPlace {
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

  const foldKey = `${place.docPath}\n${found.path}#${heading ?? ""}^${link.block ?? ""}`;
  // To open where it comes from, on hover at its top right.
  const open = document.createElement("button");
  open.type = "button";
  open.className = "note-embed-open";
  open.textContent = "↗";
  open.setAttribute("aria-label", currentStrings().hoverOpen);
  open.title = content.title || name;
  const body = document.createElement("div");
  body.className = "note-embed-body";
  // Embeds in it are drawn one level down, never one already on the way.
  body.dataset.embedChain = JSON.stringify([...place.chain, key]);
  body.dataset.embedDepth = String(place.depth + 1);
  el.className = "note-embed";
  el.dataset.path = found.path;
  el.dataset.anchor = link.block ? `^${link.block}` : (heading ?? "");
  // Its content alone, as one block: folded by the margin's caret, as
  // every drawn block is, to a line with its name.
  el.replaceChildren(open, body);
  addBlockFoldMarkup(el, content.title || name, foldKey);
  showBlockFold(el, embedFolded(foldKey));
  // Drawn by the editor itself, as the note shows when open.
  const preview = await drawPreview(
    body,
    content.markdown,
    found.path,
    () => content.title || name,
  );
  if (place.signal.aborted || !el.isConnected) return preview.destroy();
  previews.get(el)?.destroy();
  previews.set(el, preview);
}

const previews = new WeakMap<HTMLElement, PreviewHandle>();

/** Lets go of the editor drawing the embed in `el`, as it leaves. */
export function releaseEmbed(el: HTMLElement): void {
  previews.get(el)?.destroy();
  previews.delete(el);
}

/** Where an embed drawn inside another embed's body stands: one level
 *  down, after the parts on the way. */
export function embedDepthOf(dom: Element): { depth: number; chain: string[] } {
  const outer = dom.closest<HTMLElement>("[data-embed-chain]");
  if (!outer) return { depth: 1, chain: [] };
  return {
    depth: Number(outer.dataset.embedDepth) || 1,
    chain: JSON.parse(outer.dataset.embedChain ?? "[]") as string[],
  };
}
