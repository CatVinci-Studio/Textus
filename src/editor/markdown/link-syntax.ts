import { noteStem } from "../../utils/path";

/**
 * A link's Markdown, read: the link node holds its source as text, and what
 * it points at, what to draw and what to hide all come from that text.
 */

export type LinkKind = "inline" | "reference" | "autolink" | "bare";

export interface LinkParts {
  kind: LinkKind;
  /** Where the source ends; the whole text for a lone link. */
  end: number;
  /** The text shown as the link: `[` to `]` for the bracket forms. */
  label: [number, number];
  /** The destination as written, or a reference's label. */
  dest: string;
  title: string;
}

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const AUTOLINK =
  /^<((?:[a-z][a-z0-9+.-]{1,31}:[^\s<>]*)|(?:[\w.!#$%&'*+/=?^`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*))>/i;
const BARE =
  /^(?:(?:https?:\/\/|www\.)[^\s<>]+|mailto:[^\s<>]+|[\w.+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)/i;

/** Where the bracketed label opened at `start` closes, past escapes and
 *  code spans; -1 when it doesn't. */
function labelEnd(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (char === "\\" && PUNCTUATION.test(text[i + 1] ?? "")) i++;
    else if (char === "`") {
      const run = /^`+/.exec(text.slice(i))![0];
      const close = text.indexOf(run, i + run.length);
      if (close > 0) i = close + run.length - 1;
    } else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) return i;
  }
  return -1;
}

/** An inline link's `(dest "title")` from `start` (its "("): the destination,
 *  the title and the index past ")", or null. */
function resource(
  text: string,
  start: number,
): { dest: string; title: string; end: number } | null {
  let i = start + 1;
  const skip = () => {
    while (/[ \t\n]/.test(text[i] ?? "")) i++;
  };
  skip();
  let dest: string;
  if (text[i] === "<") {
    const close = text.indexOf(">", i);
    if (close < 0 || /[\n<]/.test(text.slice(i + 1, close))) return null;
    dest = text.slice(i + 1, close);
    i = close + 1;
  } else {
    let depth = 0;
    const from = i;
    for (; i < text.length; i++) {
      const char = text[i];
      if (char === "\\" && PUNCTUATION.test(text[i + 1] ?? "")) i++;
      else if (/\s/.test(char) || char < " ") break;
      else if (char === "(") depth++;
      else if (char === ")" && depth-- === 0) break;
    }
    dest = text.slice(from, i);
  }
  const beforeTitle = i;
  skip();
  let title = "";
  const quote = text[i];
  const closer = quote === "(" ? ")" : quote;
  if ((quote === '"' || quote === "'" || quote === "(") && i > beforeTitle) {
    let j = i + 1;
    for (; j < text.length && text[j] !== closer; j++)
      if (text[j] === "\\") j++;
    if (j >= text.length) return null;
    title = text.slice(i + 1, j);
    i = j + 1;
    skip();
  }
  return text[i] === ")" ? { dest, title, end: i + 1 } : null;
}

/** The link whose source starts at `start` in `text`, or null. */
export function linkAt(text: string, start = 0): LinkParts | null {
  const rest = text.slice(start);
  if (text[start] === "<") {
    const match = AUTOLINK.exec(rest);
    return match
      ? {
          kind: "autolink",
          end: start + match[0].length,
          label: [start + 1, start + match[0].length - 1],
          dest: match[1],
          title: "",
        }
      : null;
  }
  if (text[start] !== "[") {
    const match = BARE.exec(rest);
    if (!match) return null;
    const url = trimUrl(match[0]);
    return url
      ? {
          kind: "bare",
          end: start + url.length,
          label: [start, start + url.length],
          dest: url,
          title: "",
        }
      : null;
  }
  const close = labelEnd(text, start);
  if (close < 0) return null;
  const label: [number, number] = [start + 1, close];
  if (text[close + 1] === "(") {
    const found = resource(text, close + 1);
    if (found) return { kind: "inline", label, ...found };
  }
  if (text[close + 1] === "[") {
    const refEnd = text.indexOf("]", close + 2);
    if (refEnd > 0 && !text.slice(close + 2, refEnd).includes("[")) {
      const ref = text.slice(close + 2, refEnd);
      return {
        kind: "reference",
        end: refEnd + 1,
        label,
        dest: ref || text.slice(...label),
        title: "",
      };
    }
  }
  return {
    kind: "reference",
    end: close + 1,
    label,
    dest: text.slice(...label),
    title: "",
  };
}

/** `text` read as one whole link, or null. */
export function parseLink(text: string): LinkParts | null {
  const parts = linkAt(text);
  return parts && parts.end === text.length ? parts : null;
}

/** A bare URL without the punctuation GFM leaves after it. */
export function trimUrl(url: string): string {
  let end = url.length;
  for (;;) {
    const last = url[end - 1];
    if (!last) return "";
    if (".,:;!?\"'".includes(last)) end--;
    else if (last === ")") {
      const inside = url.slice(0, end);
      if (inside.split("(").length < inside.split(")").length) end--;
      else return inside;
    } else return url.slice(0, end);
  }
}

/**
 * The source a link hides while the caret is away, as offsets in its text:
 * the brackets and what follows the label, or an autolink's `<` `>`. An
 * empty label shows the URL instead. Null when the text is no one link.
 */
export function hiddenLinkParts(text: string): [number, number][] | null {
  const parts = parseLink(text);
  if (!parts) return null;
  const [from, to] = parts.label;
  if (parts.kind === "bare") return [];
  if (from < to)
    return [
      [0, from],
      [to, text.length],
    ];
  if (parts.kind !== "inline" || !parts.dest) return null;
  const dest = text.indexOf(parts.dest, to);
  return [
    [0, dest],
    [dest + parts.dest.length, text.length],
  ];
}

/** Backslash escapes taken out, as a destination or title reads. */
const unescape = (text: string) => text.replace(/\\([!-/:-@[-`{-~])/g, "$1");

/** The `[label]: url "title"` definition's URL and title, or null. */
export function readDefinition(
  source: string,
): { label: string; url: string; title: string } | null {
  const match =
    /^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>\n]*)>|(\S+))(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*$/.exec(
      source,
    );
  if (!match) return null;
  return {
    label: match[1],
    url: unescape(match[2] ?? match[3]),
    title: match[4] ?? match[5] ?? match[6] ?? "",
  };
}

/** Labels match without case, inner white space folded. */
export const normalLabel = (label: string) =>
  label.trim().replace(/\s+/g, " ").toLowerCase();

/** The definition among `definitions` (their sources) for `label`. */
function definitionFor(
  label: string,
  definitions: () => string[],
): { url: string; title: string } | null {
  const wanted = normalLabel(label);
  for (const source of definitions()) {
    const definition = readDefinition(source);
    if (definition && normalLabel(definition.label) === wanted)
      return definition;
  }
  return null;
}

/** Where the link `text` points, references read against `definitions`
 *  (their sources); null for none. */
export function linkHref(
  text: string,
  definitions: () => string[] = () => [],
): string | null {
  const parts = parseLink(text);
  if (!parts) return null;
  if (parts.kind === "bare")
    return /^www\./i.test(parts.dest)
      ? `http://${parts.dest}`
      : /^(?:https?|mailto):/i.test(parts.dest)
        ? parts.dest
        : `mailto:${parts.dest}`;
  if (parts.kind === "autolink")
    return parts.dest.includes(":") ? parts.dest : `mailto:${parts.dest}`;
  if (parts.kind === "inline") return unescape(parts.dest);
  return definitionFor(parts.dest, definitions)?.url ?? null;
}

/** A reference link whose definition isn't among `labels` (normalLabel
 *  of each): it reads as text once the file is opened again. */
export function isDanglingReference(
  text: string,
  labels: Set<string>,
): boolean {
  const parts = parseLink(text);
  return parts?.kind === "reference" && !labels.has(normalLabel(parts.dest));
}

/** A reference link written out as an inline one, for where its definition
 *  isn't; null for any other text. */
export function inlinedReference(
  text: string,
  definitions: () => string[],
): string | null {
  const parts = parseLink(text);
  if (parts?.kind !== "reference") return null;
  const definition = definitionFor(parts.dest, definitions);
  if (!definition) return null;
  return inlineLink(
    text.slice(...parts.label),
    definition.url,
    definition.title,
  );
}

/** `text` around the first link in it: what comes before and after, which
 *  belong outside the link; null when it holds none. */
export function splitAroundLink(
  text: string,
): { lead: string; link: string; trail: string } | null {
  for (let i = 0; i < text.length; i++) {
    if (i > 0 && text[i] !== "[" && text[i] !== "<" && !/\s/.test(text[i - 1]))
      continue;
    const parts = linkAt(text, i);
    if (parts)
      return {
        lead: text.slice(0, i),
        link: text.slice(i, parts.end),
        trail: text.slice(parts.end),
      };
  }
  return null;
}

/** An inline link's source: `markdown` as its label, then `url` and
 *  `title`. */
export function inlineLink(markdown: string, url: string, title = ""): string {
  const dest = /[\s()<>]/.test(url) ? `<${url}>` : url;
  const titled = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
  return `[${markdown}](${dest}${titled})`;
}

/** A link's source for the text `label` pointing at `url`, the label's
 *  brackets escaped. */
export const linkSource = (label: string, url: string): string =>
  inlineLink(label.replace(/([\\[\]])/g, "\\$1"), url);

/** A link to a note as a folder writes it: `[[wiki]]` or Markdown. */
export interface NoteLinkParts {
  wiki: boolean;
  /** The note as named in the link ("Note", "a/Note.md"); "" for the
   *  document the link is in. */
  target: string;
  heading?: string;
  /** A block's id, without "^". */
  block?: string;
  alias?: string;
  embed?: boolean;
}

/** The source of a link to a note: `[[Note#Heading|alias]]`, `[[#^id]]`,
 *  `[alias](a/My%20Note.md#^id)`; `!` before it for an embed. */
export function noteLinkSource(link: NoteLinkParts): string {
  const anchor = link.block
    ? `#^${link.block}`
    : link.heading
      ? `#${link.heading}`
      : "";
  const bang = link.embed ? "!" : "";
  if (link.wiki)
    return `${bang}[[${link.target}${anchor}${link.alias ? `|${link.alias}` : ""}]]`;
  const name = noteStem(link.target.slice(link.target.lastIndexOf("/") + 1));
  const label =
    link.alias || (link.target ? name : (link.heading ?? `^${link.block}`));
  // Obsidian's Markdown links write a space as %20, nothing else encoded.
  return (
    bang + linkSource(label, `${link.target}${anchor}`.replace(/ /g, "%20"))
  );
}
