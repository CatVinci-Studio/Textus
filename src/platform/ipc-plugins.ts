import type * as Generated from "./bindings/plugins";
import { call, command, desktopActionCommand } from "./ipc-call";

/**
 * Plugins (src-tauri/src/plugins/) and MCP servers (src-tauri/src/mcp/):
 * the calls Settings › Extensions and the plugin broker make. Re-exported
 * from ipc.ts.
 */

// ---------------------------------------------------------------------------
// plugins (src-tauri/src/plugins/) - what is installed and granted, and the
// calls a plugin makes through the window (src/plugins/broker.ts).
// ---------------------------------------------------------------------------

// Generated from the Rust commands (src/platform/bindings/plugins.ts):
// PluginsState in plugins/state.rs, CatalogEntry in plugins/catalog.rs,
// InstalledPlugin in plugins/install.rs, FsEntry and HttpResponse in
// plugins/access.rs.
export type PluginsState = Generated.PluginsState_Serialize;
export type PluginCatalogEntry = Generated.CatalogEntry_Serialize;
export type { InstalledPlugin } from "./bindings/plugins";
export type PluginFsEntry = Generated.FsEntry_Serialize;
export type PluginHttpResponse = Generated.HttpResponse;

/** A raw IPC response's bytes (tauri::ipc::Response) - which specta has no
 *  type for, so the commands answering one go through `call`. */
const bytes = async (pending: Promise<ArrayBuffer>) =>
  new Uint8Array(await pending);

/** One tool an MCP server offers (McpTool in src-tauri mcp/client.rs). */
export type McpToolInfo = Generated.McpTool;

/** A server that is on, as it is now (ServerStatus in src-tauri
 *  mcp/mod.rs, which sends its state as a string). */
export interface McpServerStatus extends Generated.ServerStatus_Serialize {
  state: "starting" | "ready" | "failed";
}

/** The MCP servers Settings › Extensions › MCP lists. Desktop only. */
export const mcp = {
  /** Brings the running servers in line with the settings, and says how
   *  each one that is on is doing. */
  status: () => command("mcp_status") as Promise<McpServerStatus[]>,
  restart: (id: string) =>
    command("mcp_restart", id) as Promise<McpServerStatus[]>,
  /** Starts a server not saved yet, asks for its tools and stops it. The
   *  server is a settings entry, opaque JSON to Rust. */
  try: (server: unknown) => command("mcp_try", server as Generated.Value),
};

export const plugins = {
  state: () => command("plugins_state"),
  setAll: (on: boolean) => command("plugins_set_all", on),
  set: (id: string, enabled: boolean, granted: string[]) =>
    command("plugin_set", id, enabled, granted),
  installed: () => command("plugins_installed"),
  install: (path: string) => command("plugin_install", path),
  loadDev: (path: string) => command("plugin_load_dev", path),
  uninstall: (id: string) => command("plugin_uninstall", id),
  /** The plugins Textus offers (textus-plugins' catalog), fetched now
   *  and kept for next time. */
  catalog: () => command("plugin_catalog"),
  /** The catalog as last fetched, if one was kept. */
  cachedCatalog: () => command("plugin_catalog_cached"),
  /** Downloads one from the catalog, checks it and installs it. */
  installFromCatalog: (id: string) => command("plugin_install_catalog", id),
  /** Install from file… (`folder` false) and Load a plugin folder…'s
   *  picker. Desktop only. */
  pickPackage: (folder: boolean, filterName: string) =>
    desktopActionCommand("plugin_pick_package", folder, filterName),
  file: (id: string, rel: string) =>
    bytes(call<ArrayBuffer>("plugin_file", { id, rel })),
  readResource: (id: string, path: string) =>
    bytes(call<ArrayBuffer>("plugin_read_resource", { id, path })),
  fsRead: (id: string, root: string, path: string) =>
    bytes(call<ArrayBuffer>("plugin_fs_read", { id, root, path })),
  fsList: (id: string, root: string, path: string) =>
    command("plugin_fs_list", id, root, path),
  fsRename: (id: string, root: string, from: string, to: string) =>
    command("plugin_fs_rename", id, root, from, to),
  /** To the system Trash: nothing a plugin removes is gone for good. */
  fsTrash: (id: string, root: string, path: string) =>
    command("plugin_fs_trash", id, root, path),
  fsMkdir: (id: string, root: string, path: string) =>
    command("plugin_fs_mkdir", id, root, path),
  fsWrite: (
    id: string,
    root: string,
    path: string,
    contents: string,
    base64 = false,
  ) => command("plugin_fs_write", id, root, path, contents, base64),
  http: (
    id: string,
    request: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      bodyBase64?: boolean;
    },
  ) => command("plugin_http", id, request),
  /** A plugin's storage is its own JSON, opaque to Rust. */
  storageGet: (id: string) =>
    command("plugin_storage_get", id) as Promise<Record<string, unknown>>,
  storageSet: (id: string, key: string, value: unknown) =>
    command("plugin_storage_set", id, key, value as Generated.Value),
};
