import { appVersion } from "../../platform/app-info";
import { slashed } from "../../utils/path";
import { getWindowAccess } from "../app-bridge";
import {
  backlinksIn,
  refreshMetadataIndex,
  tagsIn,
  tasksIn,
} from "../workspace/metadata-cache";

/** Who the app's tools ask the folder's index as: no plugin is named so. */
export const APP_TOOLS_OWNER = "textus";
const MOST_TASKS = 100;

type Args = Record<string, unknown>;
const text = (args: Args, key: string) =>
  typeof args[key] === "string" ? (args[key] as string).trim() : "";

/** The folder the AI works in, which its call carries: the sidebar's may
 *  be another. */
async function folder(args: Args) {
  const root = text(args, "__root") || getWindowAccess()?.rootPath();
  if (!root) throw new Error("No folder is open.");
  const index = await refreshMetadataIndex(APP_TOOLS_OWNER, root);
  const rel = (path: string) => index.byPath.get(path)?.rel ?? path;
  return { index, rel };
}

/** The document a model names by its path in the folder. */
function documentAt(
  index: Awaited<ReturnType<typeof folder>>["index"],
  path: string,
) {
  const want = slashed(path).replace(/^\.?\//, "");
  return index.documents.find(
    (d) => slashed(d.rel) === want || slashed(d.path) === slashed(path),
  );
}

async function listTasks(args: Args) {
  const { index, rel } = await folder(args);
  const status = text(args, "status") || "open";
  const at = text(args, "path");
  const doc = at ? documentAt(index, at) : undefined;
  if (at && !doc) return `No note ${at} in the folder.`;
  const before = text(args, "due_before");
  const words = text(args, "query").toLowerCase().split(/\s+/).filter(Boolean);
  const limit = Number(args.limit) > 0 ? Number(args.limit) : MOST_TASKS;
  const found = tasksIn(index, {
    done: status === "all" ? undefined : status === "done",
    path: doc?.path,
    tag: text(args, "tag") || undefined,
  }).filter(
    (t) =>
      (!before || (t.due !== null && t.due <= before)) &&
      words.every((w) => t.text.toLowerCase().includes(w)),
  );
  if (!found.length) return "No tasks match.";
  const lines = found
    .slice(0, limit)
    .map(
      (t) =>
        `${rel(t.path)}:${t.line + 1}: [${t.done ? "x" : " "}] ${t.text}${t.due ? ` (due ${t.due})` : ""}`,
    );
  if (found.length > limit) lines.push(`… and ${found.length - limit} more.`);
  return lines.join("\n");
}

async function backlinks(args: Args) {
  const { index, rel } = await folder(args);
  const doc = documentAt(index, text(args, "path"));
  if (!doc) return `No note ${text(args, "path")} in the folder.`;
  const links = backlinksIn(index, doc.path);
  if (!links.length) return `No note links to ${doc.rel}.`;
  return links.map((l) => `${rel(l.path)}:${l.line + 1}: ${l.text}`).join("\n");
}

async function listTags(args: Args) {
  const { index } = await folder(args);
  const tags = tagsIn(index);
  if (!tags.length) return "The folder's notes have no tags.";
  return tags.map((t) => `#${t.tag} (${t.count})`).join("\n");
}

async function notesWithTag(args: Args) {
  const { index } = await folder(args);
  const tag = text(args, "tag").replace(/^#/, "").toLowerCase();
  const notes = index.documents.filter((d) =>
    d.tags.some((t) => {
      const own = t.toLowerCase();
      return own === tag || own.startsWith(`${tag}/`);
    }),
  );
  if (!notes.length) return `No note has #${tag}.`;
  return notes.map((d) => `${d.rel} - ${d.title}`).join("\n");
}

async function checkPlugin(args: Args) {
  const [{ checkWrittenPlugin }, version] = await Promise.all([
    import("../store/check-written-plugin"),
    appVersion(),
  ]);
  return checkWrittenPlugin(args.files, version);
}

const TOOLS: Record<string, (args: Args) => Promise<string>> = {
  check_plugin: checkPlugin,
  list_tasks: listTasks,
  backlinks,
  list_tags: listTags,
  notes_with_tag: notesWithTag,
};

/** The app's own tools that run in the window (Rust's app_tools.rs offers
 *  them), called as a plugin's are: by name. */
export function appTool(name: string, args: unknown): Promise<string> {
  const run = TOOLS[name];
  if (!run) return Promise.reject(new Error(`No tool ${name}.`));
  return run(args && typeof args === "object" ? (args as Args) : {});
}
