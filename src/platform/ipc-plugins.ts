import type * as Generated from "./bindings/plugins";
import type * as Access from "./bindings/plugin-access";

/** A plugin file as text. */
export type PluginFile = Generated.PluginFile;
import { call, command, desktopActionCommand } from "./ipc-call";

/** Plugins and MCP servers: the calls Settings › Extensions and the plugin broker make. */

// Plugins: what is installed and granted, and the calls a plugin makes
// through the window.

export type PluginsState = Generated.PluginsState_Serialize;
export type PluginCatalogEntry = Generated.CatalogEntry_Serialize;
export type { InstalledPlugin } from "./bindings/plugins";
export type StoreScope = Access.StoreScope;
export type PluginDocumentMeta = Access.DocumentMeta_Serialize;

/** A raw IPC response's bytes, which specta can't type, so those commands
 *  go through `call`. */
const bytes = async (pending: Promise<ArrayBuffer>) =>
  new Uint8Array(await pending);

/** One tool an MCP server offers. */
export type McpToolInfo = Generated.McpTool;

/** A server that is on, as it is now. */
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
  /** A plugin from its files' text (what Textus AI writes), installed as a
   *  package is. */
  installFiles: (files: PluginFile[]) => command("plugin_install_files", files),
  loadDev: (path: string) => command("plugin_load_dev", path),
  uninstall: (id: string) => command("plugin_uninstall", id),
  /** Export for Publishing: the new folder's path. */
  exportPlugin: (id: string, publisher: string, folder: string) =>
    command("plugin_export", id, publisher, folder),
  /** textus:// links waiting for a window, taken. */
  takeUris: () => command("plugin_take_uris"),
  /** The plugins Textus offers, fetched now and kept for next time. */
  catalog: () => command("plugin_catalog"),
  /** The catalog as last fetched, if one was kept. */
  cachedCatalog: () => command("plugin_catalog_cached"),
  /** A catalog plugin's README in `language` (else English), before it is
   *  installed; null when it has none. */
  catalogReadme: (id: string, language: string) =>
    command("plugin_catalog_readme", id, language),
  /** Downloads one from the catalog, checks it and installs it. */
  installFromCatalog: (id: string) => command("plugin_install_catalog", id),
  /** The skills the catalog last read lists. */
  skillCatalog: () => command("skill_catalog"),
  /** Downloads a skill from the catalog into the global skills/ folder;
   *  SKILL_EXISTS when one of that name is there already. */
  installSkillFromCatalog: (name: string) =>
    command("skill_install_catalog", name),
  /** Install from file… (`folder` false) and Load a plugin folder…'s
   *  picker. Desktop only. */
  pickPackage: (folder: boolean, filterName: string) =>
    desktopActionCommand("plugin_pick_package", folder, filterName),
  /** Settings › Plugins › Open Scripts Folder. Desktop only. */
  openScriptsDir: () => desktopActionCommand("plugin_open_scripts_dir"),
  file: (id: string, rel: string) =>
    bytes(call<ArrayBuffer>("plugin_file", { id, rel })),
  readResource: (id: string, path: string) =>
    bytes(call<ArrayBuffer>("plugin_read_resource", { id, path })),
  fsRead: (id: string, root: string, path: string) =>
    bytes(call<ArrayBuffer>("plugin_fs_read", { id, root, path })),
  fsList: (id: string, root: string, path: string) =>
    command("plugin_fs_list", id, root, path),
  /** The folder's Markdown documents with their text, in one call. */
  fsDocuments: (id: string, root: string) =>
    command("plugin_fs_documents", id, root),
  fsSearch: (id: string, root: string, query: string, limit: number | null) =>
    command("plugin_fs_search", id, root, query, limit),
  fsRename: (id: string, root: string, from: string, to: string) =>
    command("plugin_fs_rename", id, root, from, to),
  /** To the system Trash: nothing a plugin removes is gone for good. */
  fsTrash: (id: string, root: string, path: string) =>
    command("plugin_fs_trash", id, root, path),
  fsMkdir: (id: string, root: string, path: string) =>
    command("plugin_fs_mkdir", id, root, path),
  fsStat: (id: string, root: string, path: string) =>
    command("plugin_fs_stat", id, root, path),
  fsCreate: (id: string, root: string, path: string, text: string) =>
    command("plugin_fs_create", id, root, path, text),
  /** A text file and a token naming its version. */
  fsReadVersioned: (id: string, root: string, path: string) =>
    command("plugin_fs_read_versioned", id, root, path),
  /** Writes only if the file is still the version `token` names. */
  fsWriteIf: (
    id: string,
    root: string,
    path: string,
    text: string,
    token: string,
  ) => command("plugin_fs_write_if", id, root, path, text, token),
  /** Every document of the folder and what it holds, and what changed
   *  since last asked. */
  metadataAll: (id: string, root: string) =>
    command("plugin_metadata_all", id, root),
  metadataGet: (id: string, root: string, path: string) =>
    command("plugin_metadata_get", id, root, path),
  secretGet: (id: string, key: string) => command("plugin_secret_get", id, key),
  secretSet: (id: string, key: string, value: string | null) =>
    command("plugin_secret_set", id, key, value),
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
  // A plugin's two stores: `root` is the open folder, for the project's.
  storeGet: (id: string, scope: StoreScope, root: string | null, key: string) =>
    command("plugin_store_get", id, scope, root, key) as Promise<unknown>,
  storeSet: (
    id: string,
    scope: StoreScope,
    root: string | null,
    key: string,
    value: unknown,
  ) => command("plugin_store_set", id, scope, root, key, value as Access.Value),
  storeKeys: (id: string, scope: StoreScope, root: string | null) =>
    command("plugin_store_keys", id, scope, root),
  storeRead: (
    id: string,
    scope: StoreScope,
    root: string | null,
    path: string,
  ) => command("plugin_store_read", id, scope, root, path),
  storeWrite: (
    id: string,
    scope: StoreScope,
    root: string | null,
    path: string,
    text: string,
  ) => command("plugin_store_write", id, scope, root, path, text),
  storeFiles: (id: string, scope: StoreScope, root: string | null) =>
    command("plugin_store_files", id, scope, root),
  storeDelete: (
    id: string,
    scope: StoreScope,
    root: string | null,
    path: string,
  ) => command("plugin_store_delete", id, scope, root, path),
  /** When a developer's plugin folder last changed (ms), or null. */
  devStamp: (id: string) => command("plugin_dev_stamp", id),
  /** The tools this window's plugins give Textus AI. */
  aiToolsSet: (tools: Generated.PluginAiTool[]) =>
    command("plugin_ai_tools_set", tools),
  aiToolResult: (callId: string, text: string | null, error: string | null) =>
    command("plugin_ai_tool_result", callId, text, error),
  /** What a plugin keeps globally and in `root`'s project, in bytes. */
  storeUsage: (id: string, root: string | null) =>
    command("plugin_store_usage", id, root),
  storeClear: (id: string, scope: StoreScope, root: string | null) =>
    command("plugin_store_clear", id, scope, root),
};
