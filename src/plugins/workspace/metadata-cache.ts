import {
  plugins as pluginsIpc,
  type PluginDocumentMeta,
} from "../../platform/ipc";
import { FILE_WRITTEN_EVENT } from "../../utils/events";
import {
  emitPluginEvent,
  getWindowAccess,
  onPluginEvent,
  type PluginLocation,
} from "../app-bridge";
import {
  parseYaml,
  type Frontmatter,
  type FrontmatterValue,
} from "./frontmatter";
import {
  pathIndex,
  resolveTarget,
  type NoteTarget,
  type PathIndex,
} from "./link-resolve";

export { pathIndex, resolveTarget, type PathIndex };

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
  /** Obsidian block ids, with their block's first words. */
  blockIds: { id: string; line: number; text: string }[];
  /** Front matter `aliases` / `alias`. */
  aliases: string[];
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

/** `resolveTarget`'s path, for a target that exists. `wiki`: `link` is a
 *  wiki link's inside, without its brackets. */
export function resolveIn(
  paths: PathIndex,
  link: string,
  from: string,
  wiki: boolean,
): string | null {
  const target = resolveTarget(paths, wiki ? `[[${link}]]` : link, from);
  return target?.exists ? target.path : null;
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
    tags: withFrontmatterTags(meta.tags, frontmatter),
    tasks: meta.tasks.map((t) => ({
      ...t,
      path: meta.path,
      location: { path: meta.path, line: t.line, text: t.text.slice(0, 60) },
    })),
    blockIds: meta.blockIds,
    aliases: listOf(frontmatter.aliases ?? frontmatter.alias),
    blocks: meta.blocks ?? undefined,
    modifiedMs: meta.modifiedMs,
  };
}

/** A front matter list, or one value split at `split`, as strings:
 *  `tags: [a, b]`, `tags: a, b` and a YAML list all read the same. */
function listOf(value: FrontmatterValue | undefined, split = /,/): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(split)
      : [];
  return items.flatMap((item) =>
    typeof item === "string" || typeof item === "number"
      ? [String(item).trim()].filter(Boolean)
      : [],
  );
}

/** The body's tags, and the front matter's (`tags:`, as Obsidian reads
 *  them, without "#"), each once. */
function withFrontmatterTags(tags: string[], frontmatter: Frontmatter) {
  const seen = new Set(tags.map((t) => t.toLowerCase()));
  const extra = listOf(frontmatter.tags ?? frontmatter.tag, /[,\s]+/)
    .map((t) => t.replace(/^#/, ""))
    .filter(
      (t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()),
    );
  return [...extra, ...tags];
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
    const paths = pathIndex(
      root,
      documents.map((d) => d.path),
    );
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

/** The line of a resolved link's heading or block in its note, as the
 *  index knows it; null for its top or one not found. */
export function targetLine(
  index: FolderIndex,
  target: NoteTarget,
): number | null {
  const doc = index.byPath.get(norm(target.path));
  if (!doc) return null;
  if (target.block)
    return doc.blockIds.find((b) => b.id === target.block)?.line ?? null;
  if (!target.heading) return null;
  const wanted = target.heading.toLowerCase();
  return (
    doc.headings.find((h) => h.text.toLowerCase() === wanted)?.line ?? null
  );
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
