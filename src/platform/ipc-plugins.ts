import type * as Generated from "./bindings/plugins";
import type * as Access from "./bindings/plugin-access";

/** A plugin file as text. */
export type PluginFile = Generated.PluginFile;
import { Channel } from "@tauri-apps/api/core";
import { call, command, desktopActionCommand } from "./ipc-call";
import { isFarUrl } from "./far-files";
import { canPickPluginFolder } from "./capabilities";
import { nativeFiles } from "./native-files";
import { dirname } from "../utils/path";

/** Plugins and MCP servers: the calls Settings › Extensions and the plugin broker make. */

/** A package picked in the Files app, copied where the install can read it
 *  by path; null when cancelled. */
async function pickFilesPackage(): Promise<string[] | null> {
  const url = await nativeFiles.pickDocument(["textusplugin", "zip"]);
  if (!url) return null;
  const name = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
  const copy = await nativeFiles.scratchPath(name);
  await command("write_base64_file", copy, await nativeFiles.readBase64(url));
  return [copy];
}

// Plugins: what is installed and granted, and the calls a plugin makes
// through the window.

export type PluginsState = Generated.PluginsState_Serialize;
export type PluginCatalogEntry = Generated.CatalogEntry_Serialize;
export type StoreScope = Access.StoreScope;
export type PluginDocumentMeta = Access.DocumentMeta_Serialize;

/** A folder the backend can't walk (an Android pick, a plugin's remote
 *  folder): its files go through far-plugin-fs.ts, not Rust. */
const inContent = (root: string) => isFarUrl(root);
const contentFs = () => import("./far-plugin-fs").then((m) => m.farPluginFs);

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

/** What an external agent's process says: a protocol line, or its end. */
type AgentOutput = Generated.AgentOutput_Deserialize;

/** External agents a plugin names, started by Rust from its manifest
 *  (src-tauri/src/agents.rs). Desktop only. */
export const agentsIpc = {
  start: (
    plugin: string,
    agent: string,
    cwd: string | null,
    onOutput: (out: AgentOutput) => void,
  ): Promise<number> => {
    const channel = new Channel<AgentOutput>();
    channel.onmessage = onOutput;
    return command("agent_start", plugin, agent, cwd, channel);
  },
  send: (handle: number, line: string) => command("agent_send", handle, line),
  stop: (handle: number) => command("agent_stop", handle),
};

export const plugins = {
  state: () => command("plugins_state"),
  /** A plugin's use of the user's AI model: Textus AI on, the user's yes,
   *  tokens this month. */
  aiStatus: (plugin: string) => command("plugin_ai_status", plugin),
  aiAllow: (plugin: string, more: boolean) =>
    command("plugin_ai_allow", plugin, more),
  /** Stopped by httpCancel(plugin, cancelId). */
  aiComplete: (
    plugin: string,
    system: string,
    prompt: string,
    cancelId: string | null,
  ) => command("plugin_ai_complete", plugin, system, prompt, cancelId),
  /** aiComplete, each piece of the answer to `onText` as it comes. */
  aiStream: (
    plugin: string,
    system: string,
    prompt: string,
    onText: (text: string) => void,
    cancelId: string | null,
  ) => {
    const channel = new Channel<string>();
    channel.onmessage = onText;
    return command(
      "plugin_ai_stream",
      plugin,
      system,
      prompt,
      channel,
      cancelId,
    );
  },
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
  /** A catalog plugin's icon as a data: URL, before it is installed; null
   *  when it has none. */
  catalogIcon: (id: string) => command("plugin_catalog_icon", id),
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
    canPickPluginFolder
      ? desktopActionCommand("plugin_pick_package", folder, filterName)
      : pickFilesPackage(),
  /** Settings › Plugins › Open Scripts Folder. Desktop only. */
  openScriptsDir: () => desktopActionCommand("plugin_open_scripts_dir"),
  file: (id: string, rel: string) =>
    bytes(call<ArrayBuffer>("plugin_file", { id, rel })),
  /** The file a plugin's tab was opened on; on Android it may be a
   *  content:// file picked with Open…, outside any folder. */
  readResource: (id: string, path: string) =>
    inContent(path)
      ? contentFs().then((f) => f.readResource(path))
      : bytes(call<ArrayBuffer>("plugin_read_resource", { id, path })),
  writeResource: (id: string, path: string, text: string) =>
    inContent(path)
      ? contentFs().then((f) => f.writeResource(path, text))
      : command("plugin_fs_write", id, dirname(path), path, text, false),
  fsRead: (id: string, root: string, path: string) =>
    inContent(root)
      ? contentFs().then((f) => f.read(root, path))
      : bytes(call<ArrayBuffer>("plugin_fs_read", { id, root, path })),
  fsList: (id: string, root: string, path: string) =>
    inContent(root)
      ? contentFs().then((f) => f.list(root, path))
      : command("plugin_fs_list", id, root, path),
  /** The folder's Markdown documents with their text, in one call. */
  fsDocuments: (id: string, root: string) =>
    inContent(root)
      ? contentFs().then((f) => f.documents(root))
      : command("plugin_fs_documents", id, root),
  fsSearch: (id: string, root: string, query: string, limit: number | null) =>
    inContent(root)
      ? contentFs().then((f) => f.search(root, query, limit))
      : command("plugin_fs_search", id, root, query, limit),
  fsRename: (id: string, root: string, from: string, to: string) =>
    inContent(root)
      ? contentFs().then((f) => f.rename(root, from, to))
      : command("plugin_fs_rename", id, root, from, to),
  /** To the system Trash: nothing a plugin removes is gone for good. */
  fsTrash: (id: string, root: string, path: string) =>
    inContent(root)
      ? contentFs().then((f) => f.trash())
      : command("plugin_fs_trash", id, root, path),
  fsMkdir: (id: string, root: string, path: string) =>
    inContent(root)
      ? contentFs().then((f) => f.mkdir(root, path))
      : command("plugin_fs_mkdir", id, root, path),
  fsStat: (id: string, root: string, path: string) =>
    inContent(root)
      ? contentFs().then((f) => f.stat(root, path))
      : command("plugin_fs_stat", id, root, path),
  fsCreate: (id: string, root: string, path: string, text: string) =>
    inContent(root)
      ? contentFs().then((f) => f.create(root, path, text))
      : command("plugin_fs_create", id, root, path, text),
  /** A text file and a token naming its version. */
  appSettings: (id: string, vault: string, name: string) =>
    command("plugin_app_settings", id, vault, name),
  fsReadVersioned: (id: string, root: string, path: string) =>
    inContent(root)
      ? contentFs().then((f) => f.readVersioned(root, path))
      : command("plugin_fs_read_versioned", id, root, path),
  /** Writes only if the file is still the version `token` names. */
  fsWriteIf: (
    id: string,
    root: string,
    path: string,
    text: string,
    token: string,
  ) =>
    inContent(root)
      ? contentFs().then((f) => f.writeIf(root, path, text, token))
      : command("plugin_fs_write_if", id, root, path, text, token),
  /** The folder's documents and what they hold: those changed since
   *  generation `after`, with the paths gone, or every one (`whole`). */
  metadataAll: (id: string, root: string, after: number | null) =>
    inContent(root)
      ? contentFs().then((f) => f.metadataAll(root, after))
      : command("plugin_metadata_all", id, root, after),
  metadataGet: (id: string, root: string, path: string) =>
    inContent(root)
      ? contentFs().then((f) => f.metadataGet(root, path))
      : command("plugin_metadata_get", id, root, path),
  /** The folder's Git branch and changes; null outside a repository. */
  gitStatus: (id: string, root: string) =>
    command("plugin_git_status", id, root),
  /** A file's commits, newest first, through renames. */
  gitLog: (id: string, root: string, path: string, limit: number | null) =>
    command("plugin_git_log", id, root, path, limit),
  gitShow: (id: string, root: string, hash: string, path: string) =>
    command("plugin_git_show", id, root, hash, path),
  gitCommit: (id: string, root: string, message: string, paths: string[]) =>
    command("plugin_git_commit", id, root, message, paths),
  gitFetch: (id: string, root: string) => command("plugin_git_fetch", id, root),
  gitPush: (id: string, root: string) => command("plugin_git_push", id, root),
  gitPull: (id: string, root: string) => command("plugin_git_pull", id, root),
  /** The writer agreed to Git running what the folder's repository sets up. */
  gitTrust: (root: string) => command("git_trust_repository", root),
  secretGet: (id: string, key: string) => command("plugin_secret_get", id, key),
  secretSet: (id: string, key: string, value: string | null) =>
    command("plugin_secret_set", id, key, value),
  fsWrite: (
    id: string,
    root: string,
    path: string,
    contents: string,
    base64 = false,
  ) =>
    inContent(root)
      ? contentFs().then((f) => f.write(root, path, contents, base64))
      : command("plugin_fs_write", id, root, path, contents, base64),
  http: (
    id: string,
    request: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      bodyBase64?: boolean;
      cancelId?: string;
    },
  ) => command("plugin_http", id, request),
  httpCancel: (id: string, cancelId: string) =>
    command("plugin_http_cancel", id, cancelId),
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
