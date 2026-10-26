import { blockIds } from "../ai/doc-blocks";

/**
 * The dev shim's answers to the plugin API's file and index commands, over
 * `window.__devFs`, so the browser build and e2e run the official plugins.
 * The index reads headings, links, tags and tasks by line.
 */

interface ShimContext {
  id: string;
  folder: Record<string, string>;
  /** Writes a file of the folder. */
  write(path: string, text: string): void;
  granted(permission: string): boolean;
}

const secrets = new Map<string, string>();

/** An uninstalled plugin's secrets go with it. */
export function forgetShimSecrets(id: string): void {
  for (const key of [...secrets.keys()])
    if (key.startsWith(`${id}\u0000`)) secrets.delete(key);
}

function token(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length}-${(h >>> 0).toString(16)}`;
}

/** What a document holds, as the backend's index reads it. */
export function shimDocumentMeta(path: string, rel: string, text: string) {
  const lines = text.split(/\r?\n/);
  let start = 0;
  let frontmatter: string | null = null;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end > 0) {
      frontmatter = lines.slice(1, end).join("\n");
      start = end + 1;
    }
  }
  const headings: { level: number; text: string; line: number }[] = [];
  const links: { target: string; text: string; line: number; wiki: boolean }[] =
    [];
  const tags: string[] = [];
  const tasks: {
    text: string;
    done: boolean;
    due: string | null;
    tags: string[];
    line: number;
  }[] = [];
  const tagsIn = (s: string) =>
    [
      ...s.matchAll(
        /(?:^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu,
      ),
    ].map((m) => m[1]);
  let fence: string | null = null;
  lines.forEach((raw, line) => {
    if (line < start) return;
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(raw);
    if (open) {
      if (fence === null) fence = open[1][0];
      else if (open[1][0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;
    const plain = raw.replace(/`+[^`]*`+/g, "");
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(plain);
    if (h) headings.push({ level: h[1].length, text: h[2], line });
    for (const m of plain.matchAll(/!?\[([^\]\n]*)\]\((<[^>\n]+>|[^)\s]+)/g))
      links.push({
        target: m[2].replace(/^<|>$/g, ""),
        text: m[1],
        line,
        wiki: false,
      });
    for (const m of plain.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
      const [target, label] = m[1].split("|");
      links.push({
        target: target.trim(),
        text: (label ?? target).trim(),
        line,
        wiki: true,
      });
    }
    for (const tag of tagsIn(h ? h[2] : plain))
      if (!tags.some((t) => t.toLowerCase() === tag.toLowerCase()))
        tags.push(tag);
    const t = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/.exec(raw);
    if (t)
      tasks.push({
        text: t[2],
        done: t[1] !== " ",
        due: /(?:📅\s*|due::?\s*)(\d{4}-\d{2}-\d{2})/u.exec(t[2])?.[1] ?? null,
        tags: tagsIn(t[2]),
        line,
      });
  });
  return {
    path,
    rel,
    title:
      headings[0]?.text ??
      (rel.split("/").pop() ?? rel).replace(/\.(md|markdown)$/i, ""),
    frontmatter,
    headings,
    links,
    tags,
    tasks,
    blocks: null as { id: string; kind: string; line: number }[] | null,
    modifiedMs: 1,
  };
}

/** A document's blocks: its paragraphs, by blank lines. */
function shimBlocks(text: string) {
  const blocks: { markdown: string; line: number }[] = [];
  let current: string[] = [];
  let first = 0;
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "") {
      if (current.length)
        blocks.push({ markdown: current.join("\n"), line: first });
      current = [];
    } else {
      if (!current.length) first = i;
      current.push(line);
    }
  });
  if (current.length)
    blocks.push({ markdown: current.join("\n"), line: first });
  const ids = blockIds(blocks.map((b) => b.markdown));
  return blocks.map((b, i) => ({
    id: ids[i],
    kind: /^#{1,6}\s/.test(b.markdown) ? "heading" : "paragraph",
    line: b.line,
  }));
}

/** Answers one of the commands, or null when it isn't one of them. */
export function pluginApiShim(
  cmd: string,
  args: Record<string, unknown>,
  c: ShimContext,
): Promise<unknown> | null {
  const path = String(args.path ?? "");
  const root = String(args.root ?? "").replace(/\/$/, "");
  const needs = (permission: string) =>
    c.granted(permission)
      ? null
      : Promise.reject(`${c.id} was not granted ${permission}.`);
  switch (cmd) {
    case "plugin_fs_stat": {
      const refused = needs("files.read");
      if (refused) return refused;
      if (path in c.folder)
        return Promise.resolve({
          name: path.split("/").pop(),
          path,
          isDir: false,
          size: c.folder[path].length,
          modifiedMs: 1,
        });
      const isDir = Object.keys(c.folder).some((p) =>
        p.startsWith(`${path.replace(/\/$/, "")}/`),
      );
      return Promise.resolve(
        isDir
          ? {
              name: path.split("/").pop(),
              path,
              isDir: true,
              size: 0,
              modifiedMs: 1,
            }
          : null,
      );
    }
    case "plugin_fs_create": {
      const refused = needs("files.write");
      if (refused) return refused;
      if (path in c.folder) return Promise.reject(`${path} is already there.`);
      c.write(path, String(args.text ?? ""));
      return Promise.resolve(null);
    }
    case "plugin_fs_read_versioned": {
      const refused = needs("files.read");
      if (refused) return refused;
      const text = c.folder[path] ?? "";
      return Promise.resolve({ text, token: token(text) });
    }
    case "plugin_fs_write_if": {
      const refused = needs("files.write");
      if (refused) return refused;
      if (token(c.folder[path] ?? "") !== String(args.token))
        return Promise.resolve(false);
      c.write(path, String(args.text));
      return Promise.resolve(true);
    }
    case "plugin_secret_get":
      return Promise.resolve(
        secrets.get(`${c.id}\u0000${String(args.key)}`) ?? null,
      );
    case "plugin_secret_set": {
      const key = `${c.id}\u0000${String(args.key)}`;
      if (typeof args.value === "string") secrets.set(key, args.value);
      else secrets.delete(key);
      return Promise.resolve(null);
    }
    case "plugin_metadata_all": {
      const refused = needs("files.read");
      if (refused) return refused;
      const documents = Object.keys(c.folder)
        .filter((p) => p.startsWith(`${root}/`) && /\.(md|markdown)$/i.test(p))
        .filter((p) => !p.slice(root.length).includes("/."))
        .sort()
        .map((p) => shimDocumentMeta(p, p.slice(root.length + 1), c.folder[p]));
      return Promise.resolve({ documents, changed: [] });
    }
    case "plugin_metadata_get": {
      const refused = needs("files.read");
      if (refused) return refused;
      const text = c.folder[path];
      if (text === undefined) return Promise.resolve(null);
      const meta = shimDocumentMeta(path, path.slice(root.length + 1), text);
      return Promise.resolve({ ...meta, blocks: shimBlocks(text) });
    }
  }
  return null;
}
