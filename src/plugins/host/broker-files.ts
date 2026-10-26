import { fs, plugins as pluginsIpc, type StoreScope } from "../../platform/ipc";
import { basename } from "../../utils/path";
import { FILE_WRITTEN_EVENT } from "../../utils/events";
import { fromBase64, toBase64 } from "../store/files";
import { emitPluginEvent, getWindowAccess } from "../app-bridge";
import { globToRegExp, isDocumentPath } from "../workspace/glob";
import {
  parseFrontmatter,
  withFrontmatter,
  type Frontmatter,
} from "../workspace/frontmatter";
import { rewriteLinks } from "../workspace/link-rewrite";
import { setWillSave } from "../contributions/will-save";
import {
  optionalStr,
  str,
  type Params,
  type PluginScope,
} from "./broker-scope";

/** A plugin's write, and the window told once it is on disk: a tab of
 *  that file picks it up (useExternalChangeReload), and plugins hear of
 *  it. */
export async function written(
  path: string,
  write: Promise<unknown>,
  change: "fileCreate" | "fileChange" = "fileChange",
): Promise<void> {
  await write;
  window.dispatchEvent(new CustomEvent(FILE_WRITTEN_EVENT, { detail: path }));
  emitPluginEvent(change, { path });
}

/** The folder a plugin's project place is in: the one open in the
 *  sidebar (null for its global place). */
function placeRoot(p: PluginScope, scope: StoreScope): string | null {
  if (scope !== "project") return null;
  p.need("project.data");
  const root = getWindowAccess()?.rootPath();
  if (!root) throw new Error("No folder is open.");
  return root;
}

/** A token for the version of a document in a tab (files.process). */
const TAB_TOKEN = "tab:";

/**
 * A plugin's calls on the folder open in the sidebar (textus.files), its
 * own storage and secrets, the clipboard and the network - each checked
 * against what the user granted; Rust checks the file and network ones
 * again (src-tauri/src/plugins/).
 */
export function fileHandlers(p: PluginScope) {
  const write = () => {
    p.need("files.write");
    return p.root();
  };
  /** Writes `text` to `path` - in its tab if it is open, else on disk -
   *  if it is still the version `token` names. */
  const writeVersion = async (path: string, text: string, token: string) => {
    const root = write();
    if (token.startsWith(TAB_TOKEN)) {
      const doc = getWindowAccess()?.documentAt(path);
      return !!doc && doc.replaceText(text, token.slice(TAB_TOKEN.length));
    }
    const ok = await pluginsIpc.fsWriteIf(p.id, root, path, text, token);
    if (ok) await written(path, Promise.resolve());
    return ok;
  };
  const readVersion = async (path: string) => {
    const root = p.root();
    const doc = getWindowAccess()?.documentAt(path);
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
      p.need("files.read");
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
      );
    },
    "files.write": ({ path, data }: Params) => {
      const target = str(path, "path");
      if (!(data instanceof Uint8Array)) throw new Error("data is bytes.");
      return written(
        target,
        pluginsIpc.fsWrite(p.id, write(), target, toBase64(data), true),
      );
    },
    "files.create": ({ path, text }: Params) => {
      const target = str(path, "path");
      return written(
        target,
        pluginsIpc.fsCreate(p.id, write(), target, optionalStr(text) ?? ""),
        "fileCreate",
      );
    },
    "files.processRead": ({ path }: Params) => {
      p.need("files.write");
      return readVersion(str(path, "path"));
    },
    "files.processWrite": ({ path, text, token }: Params) =>
      writeVersion(str(path, "path"), str(text, "text"), str(token, "token")),
    "files.rename": async ({ from, to, updateLinks }: Params) => {
      const root = write();
      const source = str(from, "from");
      const target = str(to, "to");
      await pluginsIpc.fsRename(p.id, root, source, target);
      window.dispatchEvent(
        new CustomEvent(FILE_WRITTEN_EVENT, { detail: source }),
      );
      emitPluginEvent("fileRename", { from: source, to: target });
      if (updateLinks !== true) return;
      const { documents } = await pluginsIpc.fsDocuments(p.id, root);
      for (const doc of documents) {
        if (rewriteLinks(doc.text, doc.path, source, target) === doc.text)
          continue;
        await change(doc.path, (text) =>
          rewriteLinks(text, doc.path, source, target),
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
      const doc = getWindowAccess()?.documentAt(target);
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
      p.need("files.write");
      setWillSave(p.id, on === true, (path, text) =>
        p.request<string | null>("$willSave", { path, text }),
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
    // Its own places (src-tauri plugins/store.rs): the project's is the
    // open folder's, which Rust checks project.data for.
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
      p.need("clipboard");
      return navigator.clipboard.readText();
    },
    "clipboard.writeText": ({ text }: Params) => {
      p.need("clipboard");
      return navigator.clipboard.writeText(str(text, "text"));
    },
  };
}

/** `path` in the folder `root`, `/`-separated. */
export function relOf(root: string, path: string): string {
  const r = root.replace(/\\/g, "/").replace(/\/$/, "");
  const full = path.replace(/\\/g, "/");
  return full.startsWith(`${r}/`) ? full.slice(r.length + 1) : basename(full);
}
