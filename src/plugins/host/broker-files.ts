import { notesRoot } from "../../files/link-style";
import { inOpenFolder } from "../may-open";
import { fs, plugins as pluginsIpc, type StoreScope } from "../../platform/ipc";
import { absoluteIn, basename, isInside, slashed } from "../../utils/path";
import { FILE_WRITTEN_EVENT } from "../../utils/events";
import { fromBase64, toBase64 } from "../store/files";
import {
  beforePluginMove,
  emitPluginEvent,
  getWindowAccess,
  pluginMovedPath,
} from "../app-bridge";
import { globToRegExp, isDocumentPath } from "../workspace/glob";
import {
  parseFrontmatter,
  withFrontmatter,
  type Frontmatter,
} from "../../utils/frontmatter";
import { linkRewrite } from "../../files/link-rewrite-lazy";
import { blockIdAt } from "../../files/block-id";
import { setWillExport } from "../contributions/will-export";
import { setWillSave } from "../contributions/will-save";
import {
  optionalStr,
  str,
  type Params,
  type PluginScope,
} from "./broker-scope";

/** A plugin's write, and the window told once it is on disk: a tab of that
 *  file picks it up, and plugins hear of it. */
export async function written(
  path: string,
  write: Promise<unknown>,
  change: "fileCreate" | "fileChange" = "fileChange",
  /** The plugin's folder, for a path given relative to it. */
  root?: string,
): Promise<void> {
  await write;
  // The window compares whole paths (an embed of the note); plugins hear
  // the path as it was given.
  const full = root ? absoluteIn(root, path) : path;
  window.dispatchEvent(new CustomEvent(FILE_WRITTEN_EVENT, { detail: full }));
  emitPluginEvent(change, { path });
}

/** The folder of a plugin's project place: the sidebar's. Null for global,
 *  and with no folder open, where the backend keeps a hidden one instead. */
function placeRoot(p: PluginScope, scope: StoreScope): string | null {
  if (scope !== "project") return null;
  p.need("project.data");
  return getWindowAccess()?.rootPath() ?? null;
}

/** A token for the version of a document in a tab. */
const TAB_TOKEN = "tab:";

/**
 * A plugin's calls on the open folder, its storage and secrets, the clipboard
 * and the network, each checked against what the user granted. Rust checks
 * the file and network ones again.
 */
export function fileHandlers(p: PluginScope) {
  // files.write is checked before the call runs (api-permissions.ts).
  const write = () => p.root();
  /** Writes `text` to `path` (in its tab if open, else on disk) if it is still
   *  the version `token` names. */
  const writeVersion = async (path: string, text: string, token: string) => {
    const root = write();
    if (token.startsWith(TAB_TOKEN)) {
      const doc = openDocument(root, path);
      return !!doc && doc.replaceText(text, token.slice(TAB_TOKEN.length));
    }
    const ok = await pluginsIpc.fsWriteIf(p.id, root, path, text, token);
    if (ok) await written(path, Promise.resolve(), "fileChange", root);
    return ok;
  };
  const readVersion = async (path: string) => {
    const root = p.root();
    const doc = openDocument(root, path);
    if (doc)
      return { text: doc.text(), token: `${TAB_TOKEN}${doc.revision()}` };
    return pluginsIpc.fsReadVersioned(p.id, root, path);
  };
  /** Changes `path` through its versions until a write goes through. */
  const change = async (path: string, edit: (text: string) => string) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { text, token } = await readVersion(path);
      const next = edit(text);
      if (next === text) return;
      if (await writeVersion(path, next, token)) return;
    }
    throw new Error(`${path} kept changing while it was written.`);
  };
  return {
    "files.root": () => {
      return getWindowAccess()?.rootPath() ?? null;
    },
    "files.list": async ({ path }: Params) => {
      const root = p.root();
      const dir = optionalStr(path) || root;
      const entries = await pluginsIpc.fsList(p.id, root, dir);
      return entries.map((e) => ({ ...e, rel: relOf(root, e.path) }));
    },
    "files.find": async ({ glob }: Params) => {
      const root = p.root();
      const index = await fs.indexFolder(root);
      const pattern = typeof glob === "string" ? globToRegExp(glob) : null;
      return index.files.filter((f) =>
        pattern ? pattern.test(f.rel) : isDocumentPath(f.path),
      );
    },
    "files.conventions": ({ path }: Params) =>
      fs.folderConventions(within(p.root(), optionalStr(path))),
    // The nearest vault's own file, even above the open folder: settings
    // other apps' plugins keep (bookmarks.json, a plugin's data.json).
    "files.appSettings": async ({ app, file, path }: Params) => {
      const name = str(file, "file");
      if (!/^[\w-][\w.-]*$/.test(name))
        throw new Error(`${name} isn't a settings file's name.`);
      if (str(app, "app") !== "obsidian") return null;
      const found = await fs.folderConventions(
        within(p.root(), optionalStr(path)),
      );
      const vault = [...found.sources, ...(found.detected?.sources ?? [])].find(
        (s) => s.app === "obsidian",
      )?.root;
      if (!vault) return null;
      const text = await pluginsIpc
        .appSettings(p.id, vault, name)
        .catch(() => null);
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    },
    "files.stat": async ({ path }: Params) => {
      const root = p.root();
      const stat = await pluginsIpc.fsStat(p.id, root, str(path, "path"));
      return stat && { ...stat, rel: relOf(root, stat.path) };
    },
    "files.read": ({ path }: Params) =>
      pluginsIpc.fsRead(p.id, p.root(), str(path, "path")),
    "files.writeText": ({ path, text }: Params) => {
      const target = str(path, "path");
      return written(
        target,
        pluginsIpc.fsWrite(p.id, write(), target, str(text, "text")),
        "fileChange",
        write(),
      );
    },
    "files.write": ({ path, data }: Params) => {
      const target = str(path, "path");
      if (!(data instanceof Uint8Array)) throw new Error("data is bytes.");
      return written(
        target,
        pluginsIpc.fsWrite(p.id, write(), target, toBase64(data), true),
        "fileChange",
        write(),
      );
    },
    "files.create": ({ path, text }: Params) => {
      const target = str(path, "path");
      return written(
        target,
        pluginsIpc.fsCreate(p.id, write(), target, optionalStr(text) ?? ""),
        "fileCreate",
        write(),
      );
    },
    "files.processRead": ({ path }: Params) => {
      return readVersion(str(path, "path"));
    },
    "files.processWrite": ({ path, text, token }: Params) =>
      writeVersion(str(path, "path"), str(text, "text"), str(token, "token")),
    "files.blockId": async ({ path, line }: Params) => {
      const target = str(path, "path");
      if (typeof line !== "number" || line < 0)
        throw new Error("line must be a line number from 0.");
      let id: string | null = null;
      await change(target, (text) => {
        const found = blockIdAt(text, Math.floor(line));
        id = found?.id ?? null;
        return found?.text ?? text;
      });
      return id;
    },
    "files.rename": async ({ from, to, updateLinks }: Params) => {
      const root = write();
      const source = str(from, "from");
      const target = str(to, "to");
      // A plugin may name the files from the folder.
      const abs = (path: string) =>
        /^([\\/]|[A-Za-z]:)/.test(path)
          ? path
          : `${root.replace(/[\\/]+$/, "")}/${path}`;
      await beforePluginMove(abs(source));
      await pluginsIpc.fsRename(p.id, root, source, target);
      window.dispatchEvent(
        new CustomEvent(FILE_WRITTEN_EVENT, { detail: source }),
      );
      await pluginMovedPath(abs(source), abs(target));
      if (updateLinks !== true) return;
      const [{ documents }, { files }, conventions, linkRoot] =
        await Promise.all([
          pluginsIpc.fsDocuments(p.id, root),
          fs.indexFolder(root),
          fs.folderConventions(root).catch(() => null),
          fs.documentLinkRoot(abs(target), root).catch(() => null),
        ]);
      const { linkPlanner } = await linkRewrite.load();
      const planner = linkPlanner(
        files.map((f) => f.path),
        {
          root: notesRoot(conventions) ?? root,
          from: abs(source),
          to: abs(target),
          linkRoot,
        },
      );
      for (const doc of documents) {
        if (!planner(doc)) continue;
        // Planned again on the text as it is now: it may have changed.
        await change(
          doc.path,
          (text) => planner({ path: doc.path, text })?.text ?? text,
        );
      }
    },
    "files.trash": async ({ path }: Params) => {
      const target = str(path, "path");
      await pluginsIpc.fsTrash(p.id, write(), target);
      window.dispatchEvent(
        new CustomEvent(FILE_WRITTEN_EVENT, { detail: target }),
      );
      emitPluginEvent("fileDelete", { path: target });
    },
    "files.createFolder": ({ path }: Params) =>
      pluginsIpc.fsMkdir(p.id, write(), str(path, "path")),
    "files.frontmatterGet": async ({ path }: Params) => {
      const target = str(path, "path");
      const doc = openDocument(p.root(), target);
      const text = doc
        ? doc.text()
        : new TextDecoder().decode(
            await pluginsIpc.fsRead(p.id, p.root(), target),
          );
      return parseFrontmatter(text);
    },
    "files.frontmatterSet": ({ path, frontmatter }: Params) => {
      write();
      if (!frontmatter || typeof frontmatter !== "object")
        throw new Error("frontmatter is an object.");
      return change(str(path, "path"), (text) =>
        withFrontmatter(text, frontmatter as Frontmatter),
      );
    },
    "files.willSave": ({ on }: Params) => {
      setWillSave(p.id, on === true, (request) =>
        p.request<string | null>("$willSave", request),
      );
    },
    "export.willExport": ({ on }: Params) => {
      setWillExport(p.id, on === true, (page) =>
        p.request("$willExport", page),
      );
    },
    "net.fetch": async (r: Params) => {
      const body = r.body instanceof Uint8Array ? r.body : undefined;
      const response = await pluginsIpc.http(p.id, {
        url: str(r.url, "url"),
        method: optionalStr(r.method),
        headers: (r.headers ?? undefined) as Record<string, string> | undefined,
        body: body ? toBase64(body) : undefined,
        bodyBase64: !!body,
      });
      return { ...response, body: fromBase64(response.body) };
    },
    // Its own places: the project's is the open folder's, which Rust checks
    // project.data for.
    "store.get": ({ scope, key }: Params) =>
      pluginsIpc.storeGet(
        p.id,
        scope as StoreScope,
        placeRoot(p, scope as StoreScope),
        str(key, "key"),
      ),
    "store.set": ({ scope, key, value }: Params) =>
      pluginsIpc.storeSet(
        p.id,
        scope as StoreScope,
        placeRoot(p, scope as StoreScope),
        str(key, "key"),
        value,
      ),
    "store.keys": ({ scope }: Params) =>
      pluginsIpc.storeKeys(
        p.id,
        scope as StoreScope,
        placeRoot(p, scope as StoreScope),
      ),
    "store.read": ({ scope, path }: Params) =>
      pluginsIpc.storeRead(
        p.id,
        scope as StoreScope,
        placeRoot(p, scope as StoreScope),
        str(path, "path"),
      ),
    "store.write": ({ scope, path, text }: Params) =>
      pluginsIpc.storeWrite(
        p.id,
        scope as StoreScope,
        placeRoot(p, scope as StoreScope),
        str(path, "path"),
        str(text, "text"),
      ),
    "store.files": ({ scope }: Params) =>
      pluginsIpc.storeFiles(
        p.id,
        scope as StoreScope,
        placeRoot(p, scope as StoreScope),
      ),
    "store.delete": ({ scope, path }: Params) =>
      pluginsIpc.storeDelete(
        p.id,
        scope as StoreScope,
        placeRoot(p, scope as StoreScope),
        str(path, "path"),
      ),
    "secrets.get": ({ key }: Params) =>
      pluginsIpc.secretGet(p.id, str(key, "key")),
    "secrets.set": ({ key, value }: Params) =>
      pluginsIpc.secretSet(
        p.id,
        str(key, "key"),
        typeof value === "string" ? value : null,
      ),
    "clipboard.readText": () => {
      return navigator.clipboard.readText();
    },
    "clipboard.writeText": ({ text }: Params) => {
      return navigator.clipboard.writeText(str(text, "text"));
    },
  };
}

/** `path` in the folder `root`, `/`-separated. */
function relOf(root: string, path: string): string {
  const r = slashed(root).replace(/\/$/, "");
  const full = slashed(path);
  return full.startsWith(`${r}/`) ? full.slice(r.length + 1) : basename(full);
}

/** The tab open on `path` (as given or under `root`), when it is one a
 *  plugin may reach as it may the file: in the open folder, and in nothing
 *  hidden there but the folder's own .textus - the backend's rule
 *  (access.rs in_folder). Else null, and the call goes to the backend,
 *  which says no where it should. */
export function openDocument(root: string, path: string) {
  const full = /^([\\/]|[A-Za-z]:)/.test(path)
    ? path
    : `${root.replace(/[\\/]+$/, "")}/${path}`;
  return inOpenFolder(root, full)
    ? (getWindowAccess()?.documentAt(full) ?? null)
    : null;
}

/** `path` as a full path, as given or under `root`; refused when it isn't
 *  in the open folder. */
function within(root: string, path: string | undefined): string {
  if (!path) return root;
  const full = /^([\\/]|[A-Za-z]:)/.test(path)
    ? path
    : `${root.replace(/[\\/]+$/, "")}/${path}`;
  if (full !== root && !isInside(full, root))
    throw new Error(`${path} isn't in the open folder.`);
  return full;
}
