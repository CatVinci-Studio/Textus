/**
 * A glob over paths in the folder (textus.files.find), `/`-separated:
 * `*` any run within one folder's name, `**` any run of folders, `?` one
 * character, `{a,b}` either. Case is ignored, as file systems mostly do.
 */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        // "**/" also matches no folder at all.
        if (glob[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else out += ".*";
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end < 0) out += "\\{";
      else {
        out += `(?:${glob
          .slice(i + 1, end)
          .split(",")
          .map((part) => part.replace(/[.+^${}()|[\]\\*?]/g, "\\$&"))
          .join("|")})`;
        i = end;
      }
    } else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

/** Whether a document: Markdown by its name. */
export function isDocumentPath(path: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(path);
}
