import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import { basename, dirname } from "../../utils/path";

/**
 * Links to a renamed or moved file, made to point at its new place: Markdown
 * links and pictures by relative path, [[wiki links]] by name. Anything else
 * is left exactly as it was.
 */

function sep(path: string): string {
  return path.replace(/\\/g, "/");
}

/** `to`, written relative to the folder `fromDir`. */
export function relativePath(fromDir: string, to: string): string {
  const a = sep(fromDir).split("/").filter(Boolean);
  const b = sep(to).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = a.slice(i).map(() => "..");
  return [...up, ...b.slice(i)].join("/") || ".";
}

/** Where a relative link from a document in `docDir` leads. */
function resolveFrom(docDir: string, link: string): string {
  const parts = sep(docDir).split("/");
  for (const part of sep(link).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function stem(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}

function encodeLink(path: string): string {
  return path.replace(/ /g, "%20");
}

function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const visit = (node: Nodes) => {
    if (node.type === "code" || node.type === "inlineCode") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) ranges.push([start, end]);
    } else if ("children" in node) node.children.forEach(visit);
  };
  visit(fromMarkdown(text));
  return ranges;
}

/**
 * `text` (the document at `docPath`) with its links to `from` pointing at
 * `to`; the same text when none did.
 */
export function rewriteLinks(
  text: string,
  docPath: string,
  from: string,
  to: string,
): string {
  const docDir = sep(dirname(docPath));
  const oldPath = sep(from);
  const fromStem = stem(basename(from));
  const toStem = stem(basename(to));
  let code = codeRanges(text);
  const inCode = (offset: number) =>
    code.some(([start, end]) => start <= offset && offset < end);
  // [label](target "title") and ![alt](target), outside code.
  let out = text.replace(
    /(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g,
    (all, open: string, target: string, close: string, offset: number) => {
      if (inCode(offset)) return all;
      const bare = target.startsWith("<") ? target.slice(1, -1) : target;
      if (/^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith("#")) return all;
      const [file, hash = ""] = bare.split(/(?=#)/);
      let decoded = file;
      try {
        decoded = decodeURI(file);
      } catch {
        /* a link that isn't encoded */
      }
      if (resolveFrom(docDir, decoded) !== oldPath) return all;
      const next = relativePath(docDir, sep(to)) + hash;
      return `${open}${target.startsWith("<") ? `<${next}>` : encodeLink(next)}${close}`;
    },
  );
  // [[name]], [[name#heading]], [[name|label]]: a wiki link names the file
  // without its folder; only a change of name changes it.
  if (fromStem !== toStem) {
    // The first pass can change lengths before a code span or block.
    if (out !== text) code = codeRanges(out);
    out = out.replace(
      /\[\[([^\]|#\n]+)((?:#[^\]|\n]*)?)((?:\|[^\]\n]*)?)\]\]/g,
      (all, name: string, heading: string, label: string, offset: number) => {
        if (inCode(offset)) return all;
        const trimmed = name.trim();
        const slash = trimmed.lastIndexOf("/");
        if (
          stem(trimmed.slice(slash + 1)).toLowerCase() !==
          fromStem.toLowerCase()
        )
          return all;
        return `[[${trimmed.slice(0, slash + 1)}${toStem}${heading}${label}]]`;
      },
    );
  }
  return out;
}
