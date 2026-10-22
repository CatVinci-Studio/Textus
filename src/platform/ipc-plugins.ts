import { call, desktopAction } from "./ipc-call";

/**
 * Plugins (src-tauri/src/plugins/) and MCP servers (src-tauri/src/mcp/):
 * the calls Settings › Extensions and the plugin broker make. Re-exported
 * from ipc.ts.
 */

// ---------------------------------------------------------------------------
// plugins (src-tauri/src/plugins/) - what is installed and granted, and the
// calls a plugin makes through the window (src/plugins/broker.ts).
// ---------------------------------------------------------------------------

/** PluginsState in src-tauri/src/plugins/state.rs; change both. */
export interface PluginsState {
  allOn: boolean;
  plugins: Record<
    string,
    {
      enabled: boolean;
      granted: string[];
      devPath?: string;
      /** Installed from the catalog as CatVinci's own: Official. */
      official?: boolean;
    }
  >;
}

/** CatalogEntry in src-tauri/src/plugins/catalog.rs; change both. */
export interface PluginCatalogEntry {
  id: string;
  version: string;
  official: boolean;
  /** Its textus-plugin.json. */
  manifest: unknown;
  url: string;
  sha256: string;
  size: number;
}

/** InstalledPlugin in src-tauri/src/plugins/install.rs; change both. */
export interface InstalledPlugin {
  id: string;
  dir: string;
  /** textus-plugin.json as written. */
  manifest: string;
  dev: boolean;
}

/** FsEntry in src-tauri/src/plugins/access.rs; change both. */
export interface PluginFsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedMs: number | null;
}

/** HttpResponse in src-tauri/src/plugins/access.rs; change both. */
export interface PluginHttpResponse {
  status: number;
  headers: Record<string, string>;
  /** base64 */
  body: string;
}

/** A raw IPC response's bytes (tauri::ipc::Response). */
const bytes = async (pending: Promise<ArrayBuffer>) =>
  new Uint8Array(await pending);

/** One tool an MCP server offers (src-tauri mcp/client.rs). */
export interface McpToolInfo {
  name: string;
  description: string;
}

/** A server that is on, as it is now (src-tauri mcp/mod.rs). */
export interface McpServerStatus {
  id: string;
  state: "starting" | "ready" | "failed";
  /** The name and version it gave. */
  server: string;
  tools: McpToolInfo[];
  error: string | null;
}

/** The MCP servers Settings › Extensions › MCP lists. Desktop only. */
export const mcp = {
  /** Brings the running servers in line with the settings, and says how
   *  each one that is on is doing. */
  status: () => call<McpServerStatus[]>("mcp_status"),
  restart: (id: string) => call<McpServerStatus[]>("mcp_restart", { id }),
  /** Starts a server not saved yet, asks for its tools and stops it. */
  try: (server: unknown) =>
    call<{ server: string; tools: McpToolInfo[] }>("mcp_try", { server }),
};

export const plugins = {
  state: () => call<PluginsState>("plugins_state"),
  setAll: (on: boolean) => call<void>("plugins_set_all", { on }),
  set: (id: string, enabled: boolean, granted: string[]) =>
    call<void>("plugin_set", { id, enabled, granted }),
  installed: () => call<InstalledPlugin[]>("plugins_installed"),
  install: (path: string) => call<InstalledPlugin>("plugin_install", { path }),
  loadDev: (path: string) => call<InstalledPlugin>("plugin_load_dev", { path }),
  uninstall: (id: string) => call<void>("plugin_uninstall", { id }),
  /** The plugins Textus offers (textus-plugins' catalog), fetched now. */
  catalog: () => call<PluginCatalogEntry[]>("plugin_catalog"),
  /** Downloads one from the catalog, checks it and installs it. */
  installFromCatalog: (id: string) =>
    call<InstalledPlugin>("plugin_install_catalog", { id }),
  /** Install from file… (`folder` false) and Load a plugin folder…'s
   *  picker. Desktop only. */
  pickPackage: (folder: boolean, filterName: string) =>
    desktopAction<string | null>("plugin_pick_package", { folder, filterName }),
  file: (id: string, rel: string) =>
    bytes(call<ArrayBuffer>("plugin_file", { id, rel })),
  readResource: (id: string, path: string) =>
    bytes(call<ArrayBuffer>("plugin_read_resource", { id, path })),
  fsRead: (id: string, root: string, path: string) =>
    bytes(call<ArrayBuffer>("plugin_fs_read", { id, root, path })),
  fsList: (id: string, root: string, path: string) =>
    call<PluginFsEntry[]>("plugin_fs_list", { id, root, path }),
  fsRename: (id: string, root: string, from: string, to: string) =>
    call<void>("plugin_fs_rename", { id, root, from, to }),
  /** To the system Trash: nothing a plugin removes is gone for good. */
  fsTrash: (id: string, root: string, path: string) =>
    call<void>("plugin_fs_trash", { id, root, path }),
  fsMkdir: (id: string, root: string, path: string) =>
    call<void>("plugin_fs_mkdir", { id, root, path }),
  fsWrite: (
    id: string,
    root: string,
    path: string,
    contents: string,
    base64 = false,
  ) => call<void>("plugin_fs_write", { id, root, path, contents, base64 }),
  http: (
    id: string,
    request: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      bodyBase64?: boolean;
    },
  ) => call<PluginHttpResponse>("plugin_http", { id, request }),
  storageGet: (id: string) =>
    call<Record<string, unknown>>("plugin_storage_get", { id }),
  storageSet: (id: string, key: string, value: unknown) =>
    call<void>("plugin_storage_set", { id, key, value }),
};
