// Settings' search box: what it finds and where. The index is read from
// the pages themselves as the panel renders them (SettingsPanel mounts
// every page out of sight while a query is typed), so a row added to a page
// is found with no list here to keep in step.

/** One thing a query can find: a row, or the title of a group of rows. */
export interface SearchEntry {
  /** The page it is on, as SettingsPanel names its pages. */
  page: string;
  kind: "row" | "group";
  label: string;
  /** The group the row is in - "" for a group title itself. */
  group: string;
  /** A row's "?" text, read though the card is closed. */
  help: string;
}

/** Folded for matching: case, accents and full- or half-width forms set
 *  aside, so "resume" finds "Résumé" and "ＣＳＳ" finds "CSS". Only the
 *  Latin combining accents are dropped - a Japanese voicing mark is part
 *  of the letter (が is not か). */
export function foldText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC")
    .toLowerCase();
}

const FINDABLE =
  ".settings-group-title, .settings-advanced > summary, .settings-row, .shortcut-fixed-row";

function plain(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** A label's own words, without its "?" (the button and the hidden text
 *  behind it) or what a page marks `data-search-ignore` - a count, a tag. */
function labelText(el: Element | null | undefined): string {
  if (!el) return "";
  const copy = el.cloneNode(true) as Element;
  copy
    .querySelectorAll(".info-tip, [data-search-ignore]")
    .forEach((part) => part.remove());
  return plain(copy.textContent);
}

function groupOf(el: Element): string {
  const advanced = el.closest(".settings-advanced");
  if (advanced) return labelText(advanced.querySelector(":scope > summary"));
  const fixed = el.closest(".shortcut-fixed-section");
  if (fixed) return labelText(fixed.querySelector(".shortcut-fixed-title"));
  const group = el.closest(".settings-group");
  return labelText(group?.querySelector(":scope > .settings-group-title"));
}

interface Found {
  el: HTMLElement;
  entry: Omit<SearchEntry, "page">;
}

/** Every findable thing on a rendered page, in page order. */
function* walk(root: Element): Generator<Found> {
  for (const el of root.querySelectorAll<HTMLElement>(FINDABLE)) {
    if (el.matches(".settings-group-title, summary")) {
      const label = labelText(el);
      if (label)
        yield { el, entry: { kind: "group", label, group: "", help: "" } };
      continue;
    }
    const labelEl = el.matches(".shortcut-fixed-row")
      ? el.querySelector("dt")
      : el.querySelector(".settings-row-label");
    const label = labelText(labelEl);
    if (!label) continue;
    const help = plain(
      [...el.querySelectorAll(".info-tip-description")]
        .map((d) => d.textContent)
        .join(" "),
    );
    yield { el, entry: { kind: "row", label, group: groupOf(el), help } };
  }
}

const sameEntry = (
  a: Omit<SearchEntry, "page">,
  b: Omit<SearchEntry, "page">,
) => a.kind === b.kind && a.label === b.label && a.group === b.group;

/** The findable things on a rendered page, each once. */
export function harvestPage(root: Element, page: string): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const { entry } of walk(root))
    if (!entries.some((e) => sameEntry(e, entry)))
      entries.push({ page, ...entry });
  return entries;
}

export interface SearchMatch {
  entry: SearchEntry;
  /** Matched only in the "?" text, so the result shows that text. */
  byHelp: boolean;
}

/** The entries `query` finds, in the order given: a plain substring of a
 *  label, a group's title or a row's "?" text, folded as foldText does. */
export function matchEntries(
  entries: SearchEntry[],
  query: string,
): SearchMatch[] {
  const q = foldText(query.trim());
  if (!q) return [];
  const matches: SearchMatch[] = [];
  for (const entry of entries) {
    if (foldText(entry.label).includes(q))
      matches.push({ entry, byHelp: false });
    else if (entry.help && foldText(entry.help).includes(q))
      matches.push({ entry, byHelp: true });
  }
  return matches;
}

/** Where `entry` is on its page as it is now shown. */
export function findEntryElement(
  root: Element,
  entry: SearchEntry,
): HTMLElement | null {
  for (const found of walk(root))
    if (sameEntry(found.entry, entry)) return found.el;
  return null;
}
