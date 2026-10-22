import { fs, plugins as pluginsIpc } from "../platform/ipc";
import { dirname } from "../utils/path";
import { FILE_WRITTEN_EVENT } from "../utils/events";
import { fromBase64, toBase64 } from "./files";
import { getWindowAccess } from "./app-bridge";
import type { Permission } from "./manifest";
import type { webview } from "./webviews";

/** What these calls need of the plugin making them (broker.ts's
 *  PluginHost). */
export interface PluginScope {
  id: string;
  /** Throws unless the user granted `permission`. */
  need(permission: Permission): void;
  /** The folder open in the sidebar; throws without workspace.read. */
  root(): string;
  /** One of the plugin's own webviews; throws for another's. */
  ownWebview(id: string): NonNullable<ReturnType<typeof webview>>;
  loadStorage(): Promise<Record<string, unknown>>;
}

/** A plugin's write, and the window told once it is on disk: a tab of
 *  that file picks it up (useExternalChangeReload). */
async function written(path: string, write: Promise<void>): Promise<void> {
  await write;
  window.dispatchEvent(new CustomEvent(FILE_WRITTEN_EVENT, { detail: path }));
}

/** The calls a plugin makes outside the window, each checked against
 *  what the user granted: the workspace's files, the file a view of its
 *  shows, the network, its own storage, the clipboard. Rust checks the
 *  file and network ones again (src-tauri/src/plugins/). */
export function workspaceHandlers(p: PluginScope) {
  return {
    "document.readResource": ({ webview: id }: { webview: string }) => {
      const record = p.ownWebview(id);
      if (!record.resource) throw new Error("This view shows no file.");
      return pluginsIpc.readResource(p.id, record.resource);
    },
    "document.writeResource": ({
      webview: id,
      text,
    }: {
      webview: string;
      text: string;
    }) => {
      p.need("workspace.write");
      const record = p.ownWebview(id);
      if (!record.resource) throw new Error("This view shows no file.");
      return written(
        record.resource,
        pluginsIpc.fsWrite(
          p.id,
          dirname(record.resource),
          record.resource,
          text,
        ),
      );
    },
    "workspace.rootPath": () => {
      p.need("workspace.read");
      return getWindowAccess()?.rootPath() ?? null;
    },
    "workspace.list": ({ path }: { path: string }) => {
      const root = p.root();
      return pluginsIpc.fsList(p.id, root, path || root);
    },
    "workspace.findDocuments": async () => {
      const index = await fs.indexFolder(p.root());
      return index.files;
    },
    "workspace.readFile": ({ path }: { path: string }) =>
      pluginsIpc.fsRead(p.id, p.root(), path),
    "workspace.writeText": ({ path, text }: { path: string; text: string }) => {
      p.need("workspace.write");
      return written(path, pluginsIpc.fsWrite(p.id, p.root(), path, text));
    },
    "workspace.rename": ({ from, to }: { from: string; to: string }) => {
      p.need("workspace.write");
      return written(to, pluginsIpc.fsRename(p.id, p.root(), from, to)).then(
        () => written(from, Promise.resolve()),
      );
    },
    "workspace.trash": ({ path }: { path: string }) => {
      p.need("workspace.write");
      return written(path, pluginsIpc.fsTrash(p.id, p.root(), path));
    },
    "workspace.createFolder": ({ path }: { path: string }) => {
      p.need("workspace.write");
      return pluginsIpc.fsMkdir(p.id, p.root(), path);
    },
    "workspace.writeFile": ({
      path,
      data,
    }: {
      path: string;
      data: Uint8Array;
    }) => {
      p.need("workspace.write");
      return written(
        path,
        pluginsIpc.fsWrite(p.id, p.root(), path, toBase64(data), true),
      );
    },
    "net.fetch": async (r: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: Uint8Array;
    }) => {
      const response = await pluginsIpc.http(p.id, {
        url: r.url,
        method: r.method,
        headers: r.headers,
        body: r.body ? toBase64(r.body) : undefined,
        bodyBase64: !!r.body,
      });
      return { ...response, body: fromBase64(response.body) };
    },
    "storage.get": async ({ key }: { key: string }) =>
      (await p.loadStorage())[key] ?? null,
    "storage.set": async ({ key, value }: { key: string; value: unknown }) => {
      await pluginsIpc.storageSet(p.id, key, value);
      const store = await p.loadStorage();
      if (value === null) delete store[key];
      else store[key] = value;
    },
    "clipboard.readText": () => {
      p.need("clipboard");
      return navigator.clipboard.readText();
    },
    "clipboard.writeText": ({ text }: { text: string }) => {
      p.need("clipboard");
      return navigator.clipboard.writeText(text);
    },
  };
}
