import { basename, dirname } from "../../utils/path";

/**
 * Links in a document that pointed at a file renamed or moved, made to
 * point at its new place (textus.files.rename with `updateLinks`): Markdown
 * links and pictures by their relative path, and [[wiki links]] by the
 * file's name. Anything else in the text is left exactly as it was.
 */

function sep(path: string): string {
  return path.replace(/\\/g, "/");
}

/** `to`, written relative to the folder `fromDir` - as a link in a document
 *  there spells it. */
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
  // [label](target "title") and ![alt](target), outside code.
  let out = text.replace(
    /(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g,
    (all, open: string, target: string, close: string) => {
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
  if (fromStem !== toStem)
    out = out.replace(
      /\[\[([^\]|#\n]+)((?:#[^\]|\n]*)?)((?:\|[^\]\n]*)?)\]\]/g,
      (all, name: string, heading: string, label: string) => {
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
  return out;
}
