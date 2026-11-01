import {
  plugins as pluginsIpc,
  type PluginDocumentMeta,
} from "../../platform/ipc";
import { FILE_WRITTEN_EVENT } from "../../utils/events";
import { basename, dirname } from "../../utils/path";
import {
  emitPluginEvent,
  getWindowAccess,
  onPluginEvent,
  type PluginLocation,
} from "../app-bridge";
import { parseYaml, type Frontmatter } from "./frontmatter";

/**
 * textus.metadata on the window's side: Rust's index of the open folder plus
 * what is worked out across documents (links, backlinks, tags, tasks).
 */

export interface MetaTask {
  text: string;
  done: boolean;
  due: string | null;
  tags: string[];
  path: string;
  line: number;
  location: PluginLocation;
}

export interface MetaDocument {
  path: string;
  rel: string;
  title: string;
  frontmatter: Frontmatter;
  headings: { level: number; text: string; line: number }[];
  links: {
    target: string;
    resolved: string | null;
    line: number;
    text: string;
  }[];
  tags: string[];
  tasks: MetaTask[];
  blocks?: { id: string; kind: string; line: number }[];
  modifiedMs: number | null;
}

interface FolderIndex {
  root: string;
  documents: MetaDocument[];
  byPath: Map<string, MetaDocument>;
  paths: PathIndex;
}

const norm = (path: string) => path.replace(/\\/g, "/");
const stem = (name: string) =>
  name.replace(/\.(md|markdown)$/i, "").toLowerCase();

/** A folder's paths looked up by name and by path, built once per index:
 *  a big folder's links each found in one step, not by a walk over every
 *  file. */
export interface PathIndex {
  byStem: Map<string, string[]>;
  byPath: Map<string, string>;
}

export function pathIndex(paths: readonly string[]): PathIndex {
  const byStem = new Map<string, string[]>();
  for (const p of paths) {
    const key = stem(basename(p));
    const same = byStem.get(key);
    if (same) same.push(p);
    else byStem.set(key, [p]);
  }
  return { byStem, byPath: new Map(paths.map((p) => [norm(p), p])) };
}

/** Where `link`, written in the document at `from`, goes among `paths`:
 *  a [[wiki link]] by name (the nearest when several share it), anything
 *  else as a path relative to `from`'s folder. */
export function resolveIn(
  paths: PathIndex,
  link: string,
  from: string,
  wiki: boolean,
): string | null {
  const bare = link.split("#")[0].split("|")[0].trim();
  if (!bare || /^[a-z][a-z0-9+.-]*:/i.test(bare)) return null;
  let decoded = bare;
  try {
    decoded = decodeURI(bare);
  } catch {
    /* not encoded */
  }
  const fromDir = norm(dirname(from));
  if (wiki || !decoded.includes("/")) {
    const want = stem(basename(decoded));
    const matches = paths.byStem.get(want) ?? [];
    if (wiki || !/\.\w+$/.test(decoded) || matches.length) {
      if (!matches.length) return null;
      // The one nearest the linking document: its own folder first.
      return (
        matches.find((p) => norm(dirname(p)) === fromDir) ??
        [...matches].sort((a, b) => a.length - b.length)[0]
      );
    }
  }
  const parts = fromDir.split("/");
  for (const part of norm(decoded).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const target = parts.join("/");
  return (
    paths.byPath.get(target) ??
    paths.byPath.get(`${target}.md`) ??
    paths.byPath.get(`${target}.markdown`) ??
    null
  );
}

export function documentOf(
  meta: PluginDocumentMeta,
  paths: PathIndex,
): MetaDocument {
  let frontmatter: Frontmatter = {};
  if (meta.frontmatter)
    try {
      frontmatter = parseYaml(meta.frontmatter);
    } catch {
      /* front matter we can't read is none */
    }
  return {
    path: meta.path,
    rel: meta.rel,
    title: meta.title,
    frontmatter,
    headings: meta.headings,
    links: meta.links.map((l) => ({
      target: l.target,
      text: l.text,
      line: l.line,
      resolved: resolveIn(paths, l.target, meta.path, l.wiki),
    })),
    tags: meta.tags,
    tasks: meta.tasks.map((t) => ({
      ...t,
      path: meta.path,
      location: { path: meta.path, line: t.line, text: t.text.slice(0, 60) },
    })),
    blocks: meta.blocks ?? undefined,
    modifiedMs: meta.modifiedMs,
  };
}

let current: FolderIndex | null = null;
let pending: Promise<FolderIndex> | null = null;

/** The folder's index, brought up to date; `asker` is the plugin asking
 *  (Rust checks its files.read). Told to the plugins listening when
 *  anything changed since the last time. */
export async function folderIndex(
  asker: string,
  root: string,
): Promise<FolderIndex> {
  if (pending) return pending;
  pending = (async () => {
    const { documents, changed } = await pluginsIpc.metadataAll(asker, root);
    const paths = pathIndex(documents.map((d) => d.path));
    const docs = documents.map((d) => documentOf(d, paths));
    const first = current?.root !== root;
    current = {
      root,
      documents: docs,
      byPath: new Map(docs.map((d) => [norm(d.path), d])),
      paths,
    };
    if (!first && changed.length)
      emitPluginEvent("metadata", { paths: changed });
    return current;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export function backlinksIn(index: FolderIndex, path: string) {
  const target = norm(path);
  return index.documents.flatMap((d) =>
    d.links
      .filter((l) => l.resolved && norm(l.resolved) === target)
      .map((l) => ({ path: d.path, line: l.line, text: l.text })),
  );
}

export function tagsIn(index: FolderIndex): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const d of index.documents)
    for (const tag of d.tags) {
      const key = tag.toLowerCase();
      const entry = counts.get(key) ?? { tag, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
  );
}

export function tasksIn(
  index: FolderIndex,
  filter: { done?: boolean; path?: string; tag?: string },
): MetaTask[] {
  const tag = filter.tag?.replace(/^#/, "").toLowerCase();
  return index.documents.flatMap((d) =>
    filter.path && norm(filter.path) !== norm(d.path)
      ? []
      : d.tasks.filter(
          (t) =>
            (filter.done === undefined || t.done === filter.done) &&
            (!tag || t.tags.some((x) => x.toLowerCase() === tag)),
        ),
  );
}

// ---------------------------------------------------------------------------
// Keeping it up to date
// ---------------------------------------------------------------------------

/** The plugins listening for changes: kept for the window's folder as it
 *  is when something changes, so one opened or switched later counts too. */
const watchers = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let stopWatching: (() => void) | null = null;

function soon() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const [asker] = watchers;
    const root = getWindowAccess()?.rootPath();
    if (asker && root) void folderIndex(asker, root).catch(() => {});
  }, 400);
}

/** A plugin listens to metadata.onDidChange, a folder open or not yet. */
export function watchMetadata(plugin: string): void {
  watchers.add(plugin);
  if (stopWatching) return;
  const onWritten = () => soon();
  window.addEventListener(FILE_WRITTEN_EVENT, onWritten);
  window.addEventListener("focus", onWritten);
  const stopSave = onPluginEvent("didSave", onWritten);
  stopWatching = () => {
    window.removeEventListener(FILE_WRITTEN_EVENT, onWritten);
    window.removeEventListener("focus", onWritten);
    stopSave();
  };
}

export function unwatchMetadata(plugin: string): void {
  watchers.delete(plugin);
  if (watchers.size || !stopWatching) return;
  stopWatching();
  stopWatching = null;
}
