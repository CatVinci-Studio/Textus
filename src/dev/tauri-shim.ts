/**
 * Dev-only stub of the Tauri IPC globals, so the editor runs in a plain
 * browser. Commands resolve to null; `window.__devEmitTauriEvent(name,
 * payload)` fires tracked listeners.
 */
import type {
  DirEntryInfo_Serialize,
  FolderIndex,
} from "../platform/bindings/files";
import type {
  ChatAttachment,
  StreamEvent_Serialize,
} from "../platform/bindings/ai-agent";
import type { AgentSkill_Serialize } from "../platform/bindings/ai-project";
import type { GalleryTheme_Serialize } from "../platform/bindings/app";
import type { CustomEndpointStatus_Serialize } from "../platform/bindings/auth";
import type { PluginsState_Serialize } from "../platform/bindings/plugins";
import type { FsEntry_Serialize } from "../platform/bindings/plugin-access";
import type { SentBlock } from "../ai/doc-blocks";
import { namedCall, settledArguments, settledTurns } from "./settle-calls";
import { forgetShimSecrets, pluginApiShim } from "./plugin-shim-api";
import { webPageCommand } from "./native-web-pages";
import { makeDevSchedule } from "./schedule-shim";

/** The built-in skills as `list_skills` reports them (descriptions abridged). */
const DEV_BUILTIN_SKILLS: [string, string, string, string, string][] = [
  [
    "proofread",
    "check",
    "both",
    "review",
    "Fixes typos, grammar and punctuation.",
  ],
  [
    "theme",
    "create",
    "both",
    "create",
    "Designs an editor theme from a description.",
  ],
  [
    "plugin",
    "create",
    "both",
    "create",
    "Makes a small plugin from a description.",
  ],
  ["skill", "create", "both", "create", "Saves a task you repeat as a skill."],
];

export function installDevTauriShim(): void {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as Record<string, unknown>;
  if ("__TAURI_INTERNALS__" in w) return; // real Tauri runtime present

  let nextCallbackId = 1;
  // event name -> handler callback ids (as registered via transformCallback)
  const listeners = new Map<string, number[]>();

  // The settings/UI-state/history store, in memory. Only reached when a test
  // installs `window.__BOOT__`; `window.__devStorage` exposes it, `log` included.
  // `__devLiveSettings` overrides the boot settings; `__devStorageLatency` (ms)
  // delays every storage write's answer.
  const boot = w.__BOOT__ as
    | {
        settings?: Record<string, unknown>;
        rev?: number;
        uiState?: Record<string, unknown>;
      }
    | undefined;
  const live = w.__devLiveSettings as Record<string, unknown> | undefined;
  const store = {
    settings: { ...(live ?? boot?.settings ?? {}) } as Record<string, unknown>,
    rev: (boot?.rev ?? 1) + (live ? 10 : 0),
    patches: [] as Record<string, unknown>[],
    fills: [] as Record<string, unknown>[],
    log: [] as string[],
    uiState: { ...(boot?.uiState ?? {}) } as Record<string, unknown>,
    histories: { chat: [], clipboard: [] } as Record<string, unknown[]>,
    // Conversation files by id, and how many sit in the trash.
    conversations: {} as Record<string, unknown>,
    archivedChats: 0,
    // The key is kept but, as in Rust, never handed back.
    customEndpoint: null as {
      baseUrl: string;
      apiKey: string | null;
      model: string;
    } | null,
    revisionChoices: null as unknown,
    keptProposals: {} as Record<string, unknown>,
    keptPictures: {} as Record<string, unknown>,
  };
  w.__devStorage = store;
  // Bounded: a long smoke-testing session in the browser invokes a lot.
  const log = (entry: string) => {
    if (store.log.push(entry) > 2000) store.log.splice(0, 1000);
  };
  const answer = <T>(cmd: string, value: T): Promise<T> => {
    const latency = Number(w.__devStorageLatency) || 0;
    return new Promise((resolve) =>
      setTimeout(() => {
        log(`${cmd}:done`);
        resolve(value);
      }, latency),
    );
  };
  const sameEndpoint = (a: string, b: string) =>
    a.trim().replace(/\/+$/, "") === b.trim().replace(/\/+$/, "");
  const emitSoon = (event: string, payload: unknown) =>
    queueMicrotask(() =>
      (w.__devEmitTauriEvent as (e: string, p?: unknown) => void)(
        event,
        payload,
      ),
    );
  const historyKey = (kind: unknown, entry: unknown) =>
    (entry as Record<string, unknown>)?.[kind === "chat" ? "id" : "text"];
  // A conversation is kept whole and listed as its summary.
  const keepConversation = (entry: Record<string, unknown>) => {
    store.conversations[String(entry.id)] = entry;
    const { turns, ...summary } = entry;
    return { ...summary, turnCount: Array.isArray(turns) ? turns.length : 0 };
  };
  // `window.__devChatHistory` starts the chat history, `archived` in its trash.
  const startChats = w.__devChatHistory as
    { saved: Record<string, unknown>[]; archived?: number } | undefined;
  if (startChats) {
    store.histories.chat = startChats.saved.map(keepConversation);
    store.archivedChats = startChats.archived ?? 0;
  }
  function storageCommand(
    cmd: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> | null {
    const kind = args.kind as string;
    switch (cmd) {
      case "settings_get":
        return Promise.resolve({ value: store.settings, rev: store.rev });
      // MCP servers: each one on is ready with one tool; "missing" isn't installed.
      case "mcp_status":
      case "mcp_restart": {
        // Settings live in localStorage when the page booted without the file store.
        let local: Record<string, unknown> = {};
        try {
          local = JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}");
        } catch {
          // Nothing saved.
        }
        const servers = (store.settings.mcpServers ??
          local.mcpServers ??
          []) as {
          id: string;
          name: string;
          enabled: boolean;
          command: string;
        }[];
        return Promise.resolve(
          servers
            .filter((s) => s.enabled)
            .map((s) =>
              s.command === "missing"
                ? {
                    id: s.id,
                    state: "failed",
                    server: "",
                    tools: [],
                    error: "`missing` isn't installed",
                  }
                : {
                    id: s.id,
                    state: "ready",
                    server: `${s.name} 1.0`,
                    tools: [{ name: "echo", description: "Says it back." }],
                    error: null,
                  },
            ),
        );
      }
      case "mcp_try": {
        const server = args.server as { command: string; name: string };
        return server.command === "missing"
          ? Promise.reject("`missing` isn't installed, or isn't on the PATH")
          : Promise.resolve({
              server: `${server.name || "Server"} 1.0`,
              tools: [{ name: "echo", description: "Says it back." }],
            });
      }
      case "settings_patch": {
        const patch = args.patch as Record<string, unknown>;
        store.settings = { ...store.settings, ...patch };
        store.patches.push(patch);
        store.rev += 1;
        emitSoon("settings-changed", { rev: store.rev, patch, from: "main" });
        return answer(cmd, store.rev);
      }
      case "settings_fill_defaults": {
        // Only the fields not set yet.
        const defaults = args.defaults as Record<string, unknown>;
        const added = Object.fromEntries(
          Object.entries(defaults).filter(([key]) => !(key in store.settings)),
        );
        store.fills.push(added);
        if (Object.keys(added).length > 0) {
          store.settings = { ...store.settings, ...added };
          store.rev += 1;
        }
        return answer(cmd, { value: store.settings, rev: store.rev });
      }
      case "ui_state_get":
        return Promise.resolve(store.uiState);
      case "ui_state_patch":
        store.uiState = {
          ...store.uiState,
          ...(args.patch as Record<string, unknown>),
        };
        return answer(cmd, null);
      case "history_list":
        return Promise.resolve(store.histories[kind] ?? []);
      case "history_upsert": {
        const key = historyKey(kind, args.entry);
        const entry = args.entry as Record<string, unknown>;
        const listed = kind === "chat" ? keepConversation(entry) : entry;
        store.histories[kind] = [
          listed,
          ...store.histories[kind].filter((e) => historyKey(kind, e) !== key),
        ];
        return answer(cmd, null);
      }
      case "history_remove":
        store.histories[kind] = store.histories[kind].filter(
          (e) => historyKey(kind, e) !== args.key,
        );
        if (kind === "chat") delete store.conversations[String(args.key)];
        return answer(cmd, null);
      case "history_clear":
        store.histories[kind] = [];
        if (kind === "chat") store.conversations = {};
        return answer(cmd, null);
      case "chat_history_get":
        return Promise.resolve(store.conversations[String(args.id)] ?? null);
      // Every word in one message or reply, newest conversation first.
      case "chat_history_search": {
        const terms = String(args.query)
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean);
        const hits = (
          store.histories.chat as Record<string, unknown>[]
        ).flatMap((summary) => {
          const entry = store.conversations[String(summary.id)] as
            { turns?: { kind: string; text?: string }[] } | undefined;
          const turn = entry?.turns?.find(
            (t) =>
              (t.kind === "User" || t.kind === "Assistant") &&
              terms.every((w) => (t.text ?? "").toLowerCase().includes(w)),
          );
          return turn
            ? [
                {
                  ...summary,
                  role: turn.kind === "User" ? "user" : "assistant",
                  snippet: turn.text,
                },
              ]
            : [];
        });
        return Promise.resolve(terms.length ? hits : []);
      }
      // A writer's own notes by "<part>:<path>", in `window.__devOwnNotes`.
      case "own_notes_read":
        return Promise.resolve(
          ((w.__devOwnNotes ??= {}) as Record<string, string>)[
            `${String(args.part)}:${String(args.path)}`
          ] ?? null,
        );
      case "own_notes_write": {
        const kept = (w.__devOwnNotes ??= {}) as Record<string, string>;
        const key = `${String(args.part)}:${String(args.path)}`;
        if (["[]", "{}"].includes(String(args.value))) delete kept[key];
        else kept[key] = String(args.value);
        return Promise.resolve(null);
      }
      case "chat_history_archived":
        return Promise.resolve(store.archivedChats);
      case "chat_history_move_document": {
        for (const entry of [
          ...store.histories.chat,
          ...Object.values(store.conversations),
        ] as Record<string, unknown>[])
          if (entry.docPath === args.from) entry.docPath = args.to;
        emitSoon("history-changed", {
          kind: "chat",
          op: { type: "reload" },
          from: "",
        });
        return answer(cmd, null);
      }
      // An empty key keeps the stored one, for the URL it was saved with only.
      case "custom_endpoint_status": {
        const saved = store.customEndpoint;
        return Promise.resolve(
          (saved && {
            base_url: saved.baseUrl,
            api_key: null,
            has_api_key: !!saved.apiKey,
            model: saved.model,
          }) satisfies CustomEndpointStatus_Serialize | null,
        );
      }
      case "set_custom_endpoint": {
        const baseUrl = String(args.baseUrl ?? "");
        const typed = typeof args.apiKey === "string" ? args.apiKey.trim() : "";
        const saved = store.customEndpoint;
        store.customEndpoint = {
          baseUrl,
          apiKey:
            typed ||
            (saved && sameEndpoint(saved.baseUrl, baseUrl)
              ? saved.apiKey
              : null),
          model: String(args.model ?? ""),
        };
        return Promise.resolve(null);
      }
      case "clear_custom_endpoint":
        store.customEndpoint = null;
        return Promise.resolve(null);
      case "revision_choices_read":
        return Promise.resolve(store.revisionChoices);
      case "revision_choices_write":
        store.revisionChoices = args.log ?? null;
        return answer(cmd, null);
      // A document's undecided proposals, by path.
      case "kept_proposals_read":
        return Promise.resolve(
          store.keptProposals[String(args.docPath)] ?? null,
        );
      case "kept_proposals_write":
        if (args.kept == null) delete store.keptProposals[String(args.docPath)];
        else store.keptProposals[String(args.docPath)] = args.kept;
        // Pictures kept beside them: `window.__devKeptPictures`.
        store.keptPictures[String(args.docPath)] = args.pictures ?? [];
        (window as { __devKeptPictures?: unknown }).__devKeptPictures =
          store.keptPictures;
        return answer(cmd, null);
    }
    return null;
  }

  // Saved theme stylesheets and the theme gallery, in memory.
  // `window.__devThemeGallery` is `{ offline, themes, files }`;
  // `window.__devThemeFiles` is what was saved.
  const themeFiles = new Map<string, string>();
  w.__devThemeFiles = themeFiles;
  const gallery = {
    offline: false,
    themes: [] as GalleryTheme_Serialize[],
    files: {} as Record<string, string>,
  };
  w.__devThemeGallery = gallery;
  for (const [id, name, bg, text, accent] of [
    ["paper-mint", "Paper Mint", "#eef7f1", "#183a2c", "#1f6f50"],
    ["dusk", "Dusk", "#23202b", "#ece6f2", "#e0b26b"],
  ]) {
    gallery.themes.push({
      id,
      name,
      author: "dev-shim",
      description: `A canned theme from the dev shim's gallery.`,
      license: "MIT",
      source: "https://github.com/CatVinci-Studio/textus-themes",
      created: "2026-10-17T00:00:00Z",
      updated: "2026-10-17T00:00:00Z",
      css: `themes/${id}/theme.css`,
      // Paper Mint has a dark form, as every gallery theme should.
      darkCss: id === "paper-mint" ? `themes/${id}/theme-dark.css` : null,
      previews: [`themes/${id}/preview.png`],
      installs: null,
      installs30: null,
    });
    gallery.files[`themes/${id}/theme.css`] =
      `:root { --editor-bg: ${bg}; --editor-text: ${text}; --editor-accent: ${accent}; }`;
    gallery.files[`themes/${id}/theme-dark.css`] =
      `:root { --editor-bg: #10241b; --editor-text: ${bg}; --editor-accent: ${accent}; }`;
    gallery.files[`themes/${id}/preview.png`] =
      `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="${bg}"/><rect x="16" y="18" width="80" height="10" fill="${accent}"/><rect x="16" y="40" width="128" height="6" fill="${text}" opacity=".4"/></svg>`,
      )}`;
  }
  function themeCommand(
    cmd: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> | null {
    switch (cmd) {
      case "save_theme_css":
        themeFiles.set(`${args.id}/${args.variant}`, String(args.css));
        return Promise.resolve(null);
      case "load_theme_css":
        return Promise.resolve(
          themeFiles.get(`${args.id}/${args.variant}`) ?? null,
        );
      case "delete_theme":
        for (const key of [...themeFiles.keys()])
          if (key.startsWith(`${args.id}/`)) themeFiles.delete(key);
        return Promise.resolve(null);
      case "theme_gallery_catalog":
      case "theme_gallery_css":
      case "theme_gallery_preview": {
        if (gallery.offline) return Promise.reject("error sending request");
        if (cmd === "theme_gallery_catalog")
          return Promise.resolve(gallery.themes);
        const file = gallery.files[String(args.path)];
        return file === undefined
          ? Promise.reject("the gallery answered 404 Not Found")
          : Promise.resolve(file);
      }
    }
    return null;
  }

  // Skills in memory: the 4 built-ins and one of the user's own.
  // `window.__devSkills` exposes the state.
  const skills = {
    ownModes: ["write"] as string[],
    customized: new Set<string>(),
    // Copies made before the bundled built-in last changed.
    outdated: new Set<string>(),
    files: new Map<string, string>(),
    log: [] as string[],
  };
  w.__devSkills = skills;
  const skillCopyPath = (name: string) =>
    `/home/dev/.config/textus/agent/skills/${name}.md`;
  function skillCommand(
    cmd: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> | null {
    const name = String(args.name ?? "");
    switch (cmd) {
      case "list_skills": {
        // One item per name: a customized copy replaces its built-in.
        const base = {
          prompt: "",
          packs: [] as string[],
          version: null as string | null,
          basedOn: null as string | null,
          builtinUpdated: false,
          aliases: {},
          labels: {},
        };
        const builtins = DEV_BUILTIN_SKILLS.map(
          ([skill, category, invocation, mode, description]) => {
            const modes = [mode] as AgentSkill_Serialize["modes"];
            return skills.customized.has(skill)
              ? {
                  ...base,
                  name: skill,
                  description,
                  category,
                  invocation,
                  source: "global",
                  overridesBuiltin: true,
                  modes,
                  basedOn: `${skill}@${skills.outdated.has(skill) ? 0 : 1}`,
                  builtinUpdated: skills.outdated.has(skill),
                }
              : {
                  ...base,
                  name: skill,
                  description,
                  category,
                  invocation,
                  source: "builtin",
                  overridesBuiltin: false,
                  modes,
                  version: "1",
                };
          },
        );
        const own = {
          ...base,
          name: "house-style",
          description: "Apply our house style guide to the selection",
          category: null,
          invocation: "both",
          source: "global",
          overridesBuiltin: false,
          modes: skills.ownModes as AgentSkill_Serialize["modes"],
        } satisfies AgentSkill_Serialize;
        return Promise.resolve([...builtins, own]);
      }
      // Save this skill (Create mode): the file and its modes, logged.
      case "save_written_skill":
        skills.log.push(`${cmd}:${String(args.modes)}`);
        skills.files.set(skillCopyPath("written"), String(args.text ?? ""));
        return Promise.resolve(skillCopyPath("written"));
      case "set_skill_modes":
        skills.log.push(`${cmd}:${name}:${String(args.modes)}`);
        skills.ownModes = [...((args.modes as string[]) ?? [])];
        return Promise.resolve(null);
      case "customize_builtin_skill": {
        skills.log.push(`${cmd}:${name}`);
        const path = skillCopyPath(name);
        if (!skills.customized.has(name)) {
          skills.customized.add(name);
          skills.files.set(
            path,
            `---\nname: ${name}\ndescription: The built-in ${name} skill, to change as you like.\nmetadata:\n  textus-based-on: "${name}@1"\n---\n\n# ${name}\n`,
          );
        }
        return Promise.resolve(path);
      }
      case "reset_builtin_skill": {
        skills.log.push(`${cmd}:${name}`);
        const had = skills.customized.delete(name);
        skills.outdated.delete(name);
        skills.files.delete(skillCopyPath(name));
        return Promise.resolve(had ? [skillCopyPath(name)] : []);
      }
      case "read_text_file": {
        const text = skills.files.get(String(args.path ?? ""));
        return text === undefined ? null : Promise.resolve(text);
      }
    }
    return null;
  }

  // A folder of documents in memory: `window.__devFs = { "/notes/a.md": "# A" }`
  // (files only). `__devPickFolder` answers the folder picker ("TOO_BROAD"
  // refuses); `__devRecents` are the recent lists.
  const recents = { files: [] as string[], folders: [] as string[] };
  w.__devRecents = recents;
  const pushRecent = (list: string[], path: string) => {
    const at = list.indexOf(path);
    if (at >= 0) list.splice(at, 1);
    list.unshift(path);
  };
  function fsCommand(
    cmd: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> | null {
    const files = w.__devFs as Record<string, string> | undefined;
    switch (cmd) {
      case "pick_open_folder": {
        const picked = w.__devPickFolder ?? null;
        return picked === "TOO_BROAD"
          ? Promise.reject("TOO_BROAD")
          : Promise.resolve(picked);
      }
      case "add_recent_file":
        pushRecent(recents.files, String(args.path));
        return Promise.resolve(null);
      case "add_recent_folder":
        pushRecent(recents.folders, String(args.path));
        return Promise.resolve(null);
      // `window.__devSystem` stands in for the system a report names.
      case "system_info":
        return Promise.resolve(
          w.__devSystem ?? { os: "Linux", arch: "x86_64", webview: "dev" },
        );
      case "list_recent_files":
        return Promise.resolve([...recents.files]);
      case "list_recent_folders":
        return Promise.resolve([...recents.folders]);
    }
    if (!files) return null;
    const path = String(args.path ?? args.root ?? "");
    switch (cmd) {
      case "read_text_file":
        return path in files ? Promise.resolve(files[path]) : null;
      // A save into the folder lands in it, so a test reads it back there.
      case "write_text_file":
        files[path] = String(args.contents);
        return Promise.resolve(null);
      case "file_mtime_ms":
        return Promise.resolve(path in files ? 1 : null);
      case "list_dir": {
        const entries = new Map<string, boolean>();
        for (const file of Object.keys(files)) {
          if (!file.startsWith(`${path}/`)) continue;
          const [name, ...rest] = file.slice(path.length + 1).split("/");
          entries.set(name, rest.length > 0);
        }
        return Promise.resolve(
          [...entries]
            .map(([name, isDir]) => ({
              name,
              path: `${path}/${name}`,
              is_dir: isDir,
              hidden: name.startsWith("."),
              modified_ms:
                (w.__devMtimes as Record<string, number> | undefined)?.[
                  `${path}/${name}`
                ] ?? null,
            }))
            .sort((a, b) =>
              a.is_dir !== b.is_dir
                ? a.is_dir
                  ? -1
                  : 1
                : a.name.localeCompare(b.name),
            ) satisfies DirEntryInfo_Serialize[],
        );
      }
      // A folder is the files under it; an empty one holds a hidden ".keep".
      case "tree_create_document":
      case "tree_create_folder": {
        const name = String(args.name).trim();
        if (!name || name.includes("/")) return Promise.reject("Invalid name");
        const doc = cmd === "tree_create_document";
        const target = `${String(args.dir)}/${doc && !/\.(md|markdown)$/i.test(name) ? `${name}.md` : name}`;
        if (
          Object.keys(files).some(
            (f) => f === target || f.startsWith(`${target}/`),
          )
        )
          return Promise.reject("Already exists");
        files[doc ? target : `${target}/.keep`] = "";
        return Promise.resolve(target);
      }
      case "open_path_in_new_window": {
        // No second window in the browser: what would open is recorded.
        (
          ((window as unknown as Record<string, unknown>).__devNewWindows ??=
            []) as string[]
        ).push(path);
        return Promise.resolve(null);
      }
      case "tree_move_entry": {
        const into = String(args.into);
        const target = `${into}/${path.split("/").pop()}`;
        if (into === path.slice(0, path.lastIndexOf("/")))
          return Promise.reject("Already there");
        if (into === path || into.startsWith(`${path}/`))
          return Promise.reject("A folder can't move into itself");
        if (
          Object.keys(files).some(
            (f) => f === target || f.startsWith(`${target}/`),
          )
        )
          return Promise.reject("Already exists");
        for (const file of Object.keys(files)) {
          if (file !== path && !file.startsWith(`${path}/`)) continue;
          files[target + file.slice(path.length)] = files[file];
          delete files[file];
        }
        return Promise.resolve(target);
      }
      case "tree_rename_entry": {
        const name = String(args.name).trim();
        if (!name || name.includes("/")) return Promise.reject("Invalid name");
        const isDoc =
          /\.(md|markdown)$/i.test(path) && !(`${path}/.keep` in files);
        const leaf = isDoc && !name.includes(".") ? `${name}.md` : name;
        const target = `${path.slice(0, path.lastIndexOf("/"))}/${leaf}`;
        if (target === path) return Promise.resolve(path);
        if (
          Object.keys(files).some(
            (f) => f === target || f.startsWith(`${target}/`),
          )
        )
          return Promise.reject("Already exists");
        for (const file of Object.keys(files)) {
          if (file !== path && !file.startsWith(`${path}/`)) continue;
          files[target + file.slice(path.length)] = files[file];
          delete files[file];
        }
        return Promise.resolve(target);
      }
      case "tree_trash_entry": {
        if (path === String(args.root)) return Promise.reject("Tree root");
        const trashed = ((
          window as unknown as Record<string, unknown>
        ).__devTrashed ??= []) as string[];
        for (const file of Object.keys(files)) {
          if (file !== path && !file.startsWith(`${path}/`)) continue;
          delete files[file];
        }
        trashed.push(path);
        return Promise.resolve(null);
      }
      case "index_folder": {
        // The backend refuses these; the shim's "home" is /home/me.
        if (path === "/" || path === "/home/me")
          return Promise.reject("TOO_BROAD");
        const indexed = Object.keys(files)
          .filter(
            (file) =>
              file.startsWith(`${path}/`) &&
              !file.slice(path.length).includes("/."),
          )
          .sort()
          .map((file) => ({ path: file, rel: file.slice(path.length + 1) }));
        return Promise.resolve({
          files: indexed,
          truncated: false,
        } satisfies FolderIndex);
      }
    }
    return null;
  }

  // Plugins in memory. Folder calls read `window.__devFs` (a lone document,
  // `__devFiles`); installed plugins are `__devPlugins`, and `__devPluginState`
  // starts some on. The catalog is served at /dev-plugins/; see also
  // `__devCatalogInstalled`, `__devCatalogCache`, `__devCatalogFails` and
  // `__devCatalogStats`.
  type DevPluginEntry = {
    enabled: boolean;
    granted: string[];
    official?: boolean;
  };
  const pluginState = (w.__devPluginState as
    | { allOn: boolean; plugins: Record<string, DevPluginEntry> }
    | undefined) ?? {
    allOn: true,
    plugins: {} as Record<string, DevPluginEntry>,
  };
  type CatalogEntry = {
    id: string;
    official: boolean;
    manifest: unknown;
    readme?: Record<string, string>;
    icon?: string;
  };
  let catalogEntries: Promise<CatalogEntry[]> | null = null;
  const devCatalog = () =>
    (catalogEntries ??= fetch("/dev-plugins/index.json").then((r) =>
      r.ok
        ? (r.json() as Promise<{ plugins: CatalogEntry[] }>).then((c) =>
            // `__devCatalogStats`: installs and dates by id, as the
            // release's daily count adds them.
            c.plugins.map((p) => ({
              ...p,
              ...((w.__devCatalogStats as Record<string, object> | undefined)?.[
                p.id
              ] ?? {}),
            })),
          )
        : Promise.reject(new Error("No textus-plugins checkout to list.")),
    ));
  const installFromDevCatalog = async (id: string) => {
    const entry = (await devCatalog()).find((e) => e.id === id);
    if (!entry) throw new Error(`${id} isn't in the plugin catalog.`);
    const list = ((w.__devPlugins ??= []) as Record<string, unknown>[]).filter(
      (p) => p.id !== id,
    );
    const installed = {
      id,
      dir: `/dev-plugins/${id}`,
      manifest: JSON.stringify(entry.manifest),
      dev: false,
      catalog: true,
    };
    w.__devPlugins = [...list, installed];
    pluginState.plugins[id] = {
      ...(pluginState.plugins[id] ?? { enabled: false, granted: [] }),
      official: entry.official,
    };
    return installed;
  };
  let preinstalled: Promise<unknown> | null = null;
  const preinstall = () =>
    (preinstalled ??= Promise.all(
      ((w.__devCatalogInstalled ?? []) as string[]).map((id) =>
        installFromDevCatalog(id),
      ),
    ));
  const encoded = (text: string) => new TextEncoder().encode(text).buffer;
  // Plugins' jobs and notifications: `window.__devSchedule` fires and clicks.
  const schedule = makeDevSchedule({
    allows: (plugin, permission) =>
      pluginState.allOn &&
      !!pluginState.plugins[plugin]?.enabled &&
      !!pluginState.plugins[plugin]?.granted.includes(permission),
    emit: (event, payload) => emitSoon(event, payload),
  });
  w.__devSchedule = schedule.devSchedule;
  function pluginCommand(
    cmd: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> | null {
    const id = String(args.id ?? "");
    const folder = (w.__devFs ?? {}) as Record<string, string>;
    const documents = (w.__devFiles ?? {}) as Record<string, string>;
    // `window.__devBinaryFiles = { path: base64 }`: a PDF, a picture.
    const binary = (w.__devBinaryFiles ?? {}) as Record<string, string>;
    const installed = (w.__devPlugins ?? []) as {
      id: string;
      files?: Record<string, string>;
      catalog?: boolean;
    }[];
    const path = String(args.path ?? "");
    const api = pluginApiShim(cmd, args, {
      id,
      folder,
      write: (target, text) => {
        ((w.__devFs ??= {}) as Record<string, string>)[target] = text;
      },
      granted: (permission) =>
        !!pluginState.plugins[id]?.granted.includes(permission),
    });
    if (api) return api;
    const scheduled = schedule.command(cmd, args);
    if (scheduled) return scheduled;
    const fileText = (p: string) =>
      p in binary
        ? Promise.resolve(
            Uint8Array.from(atob(binary[p]), (c) => c.charCodeAt(0)).buffer,
          )
        : p in folder
          ? Promise.resolve(encoded(folder[p]))
          : p in documents
            ? Promise.resolve(encoded(documents[p]))
            : Promise.reject(`${p}: No such file`);
    switch (cmd) {
      case "plugins_state":
        return Promise.resolve(
          structuredClone(pluginState) satisfies PluginsState_Serialize,
        );
      case "plugins_set_all":
        pluginState.allOn = !!args.on;
        return Promise.resolve(null);
      case "plugin_set":
        // As Rust does: the rest of its entry (official) stays.
        pluginState.plugins[id] = {
          ...pluginState.plugins[id],
          enabled: !!args.enabled,
          granted: [...((args.granted as string[]) ?? [])],
        };
        return Promise.resolve(null);
      case "plugins_installed":
        return preinstall().then(() =>
          ((w.__devPlugins ?? []) as typeof installed).map((plugin) => {
            const listed: Record<string, unknown> = { ...plugin };
            delete listed.files;
            delete listed.catalog;
            return listed;
          }),
        );
      case "plugin_catalog":
        if (typeof w.__devCatalogFails === "string")
          return Promise.reject(new Error(w.__devCatalogFails));
        return devCatalog().then((entries) => {
          w.__devCatalogCache = entries;
          return entries;
        });
      case "plugin_catalog_cached":
        return Promise.resolve(
          (w.__devCatalogCache as CatalogEntry[] | undefined) ?? null,
        );
      case "plugin_install_catalog":
        return installFromDevCatalog(id);
      case "plugin_catalog_icon":
        return devCatalog().then(async (entries) => {
          const url = entries.find((e) => e.id === id)?.icon;
          if (!url) return null;
          const blob = await (await fetch(url)).blob();
          return new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        });
      // As Rust picks it: the language, its base, then English.
      case "plugin_catalog_readme":
        return devCatalog().then((entries) => {
          const readme = entries.find((e) => e.id === id)?.readme ?? {};
          const lang = String(args.language);
          const url = [lang, lang.split("-")[0], "en"]
            .map((l) => readme[l])
            .find(Boolean);
          return url ? fetch(url).then((r) => r.text()) : null;
        });
      // The catalog's skills: `window.__devCatalogSkills`, installed into
      // `window.__devInstalledSkills`.
      case "skill_catalog":
        return Promise.resolve(w.__devCatalogSkills ?? []);
      case "skill_install_catalog": {
        const had = (w.__devInstalledSkills ??= []) as string[];
        const name = String(args.name);
        if (had.includes(name)) return Promise.reject("SKILL_EXISTS");
        had.push(name);
        return Promise.resolve(`/config/skills/${name}.md`);
      }
      case "plugin_file": {
        const plugin = installed.find((p) => p.id === id);
        if (plugin?.catalog)
          return fetch(`/dev-plugins/${id}/${String(args.rel)}`).then((r) =>
            r.ok
              ? r.arrayBuffer()
              : Promise.reject(`${String(args.rel)}: No such file`),
          );
        const text = plugin?.files?.[String(args.rel)];
        return text === undefined
          ? Promise.reject(`${String(args.rel)}: No such file`)
          : Promise.resolve(encoded(text));
      }
      case "plugin_read_resource":
      case "plugin_fs_read":
        return fileText(path);
      case "plugin_fs_list": {
        const dir = path.replace(/\/$/, "");
        const entries = new Map<string, boolean>();
        for (const file of Object.keys(folder)) {
          if (!file.startsWith(`${dir}/`)) continue;
          const [name, ...rest] = file.slice(dir.length + 1).split("/");
          if (!name.startsWith(".")) entries.set(name, rest.length > 0);
        }
        return Promise.resolve(
          [...entries].map(([name, isDir]) => ({
            name,
            path: `${dir}/${name}`,
            isDir,
            size: isDir ? 0 : (folder[`${dir}/${name}`] ?? "").length,
            modifiedMs: 1,
          })) satisfies FsEntry_Serialize[],
        );
      }
      case "plugin_fs_documents":
      case "plugin_fs_search": {
        const root = String(args.root).replace(/\/$/, "");
        const docs = Object.keys(folder)
          .filter(
            (p) => p.startsWith(`${root}/`) && /\.(md|markdown)$/i.test(p),
          )
          .filter((p) => !p.slice(root.length).includes("/."))
          .sort()
          .map((p) => ({
            path: p,
            rel: p.slice(root.length + 1),
            text: folder[p],
          }));
        if (cmd === "plugin_fs_documents")
          return Promise.resolve({ documents: docs, truncated: false });
        const needle = String(args.query).trim().toLowerCase();
        const limit = Number(args.limit ?? 200);
        const hits = docs.flatMap((doc) =>
          doc.text.split("\n").flatMap((text, at) =>
            needle && text.toLowerCase().includes(needle)
              ? [
                  {
                    path: doc.path,
                    rel: doc.rel,
                    line: at + 1,
                    text: text.trim(),
                  },
                ]
              : [],
          ),
        );
        return Promise.resolve({
          hits: hits.slice(0, limit),
          truncated: hits.length > limit,
        });
      }
      case "plugin_fs_write":
        ((w.__devFs ??= {}) as Record<string, string>)[path] = args.base64
          ? atob(String(args.contents))
          : String(args.contents);
        return Promise.resolve(null);
      case "plugin_http": {
        const request = args.request as {
          url: string;
          method?: string;
          body?: string;
        };
        // Every request, its body as text, in `window.__devHttpLog`;
        // answers canned by URL: `window.__devHttp[url] = { status?, body }`.
        ((w.__devHttpLog ??= []) as unknown[]).push({
          url: request.url,
          method: request.method ?? "GET",
          body: request.body
            ? decodeURIComponent(escape(atob(request.body)))
            : null,
        });
        const canned = (
          w.__devHttp as
            Record<string, { status?: number; body: string }> | undefined
        )?.[request.url];
        if (!canned) return Promise.reject("The dev shim has no network.");
        return Promise.resolve({
          status: canned.status ?? 200,
          headers: { "content-type": "text/html" },
          body: btoa(unescape(encodeURIComponent(canned.body))),
        });
      }
      // A plugin's global store and the project's per open folder, each
      // `{ kv, files }`: `window.__devPluginStore`.
      case "plugin_store_get":
      case "plugin_store_set":
      case "plugin_store_keys":
      case "plugin_store_read":
      case "plugin_store_write":
      case "plugin_store_files":
      case "plugin_store_delete": {
        const scope = String(args.scope);
        if (
          scope === "project" &&
          !pluginState.plugins[id]?.granted.includes("project.data")
        )
          return Promise.reject(`${id} was not granted project.data.`);
        if (scope === "project" && !args.root)
          return Promise.reject("No folder is open.");
        const stores = (w.__devPluginStore ??= {}) as Record<
          string,
          { kv: Record<string, unknown>; files: Record<string, string> }
        >;
        const place = (stores[
          `${id}|${scope}|${scope === "project" ? args.root : ""}`
        ] ??= { kv: {}, files: {} });
        const key = String(args.key ?? "");
        const file = String(args.path ?? "");
        switch (cmd) {
          case "plugin_store_get":
            return Promise.resolve(place.kv[key] ?? null);
          case "plugin_store_set":
            if (args.value === null) delete place.kv[key];
            else place.kv[key] = args.value;
            return Promise.resolve(null);
          case "plugin_store_keys":
            return Promise.resolve(Object.keys(place.kv).sort());
          case "plugin_store_read":
            return file in place.files
              ? Promise.resolve(place.files[file])
              : Promise.reject(`No file ${file}.`);
          case "plugin_store_write":
            place.files[file] = String(args.text);
            return Promise.resolve(null);
          case "plugin_store_files":
            return Promise.resolve(Object.keys(place.files).sort());
          default:
            delete place.files[file];
            return Promise.resolve(null);
        }
      }
      case "plugin_store_usage": {
        const stores = (w.__devPluginStore ?? {}) as Record<string, unknown>;
        const size = (key: string) =>
          JSON.stringify(stores[key] ?? "").length - 2;
        return Promise.resolve([
          size(`${id}|global|`),
          args.root ? size(`${id}|project|${args.root}`) : 0,
        ]);
      }
      case "plugin_store_clear": {
        const stores = (w.__devPluginStore ?? {}) as Record<string, unknown>;
        delete stores[
          `${id}|${args.scope}|${args.scope === "project" ? args.root : ""}`
        ];
        return Promise.resolve(null);
      }
      // `window.__devPluginStamps`; `__devStampReads` counts the looks.
      case "plugin_dev_stamp":
        w.__devStampReads = ((w.__devStampReads as number) ?? 0) + 1;
        return Promise.resolve(
          (w.__devPluginStamps as Record<string, number> | undefined)?.[id] ??
            null,
        );
      // Tools for Textus AI, and what each call answered.
      case "plugin_ai_tools_set":
        w.__devAiTools = args.tools;
        return Promise.resolve(null);
      case "plugin_ai_tool_result":
        ((w.__devAiToolResults ??= {}) as Record<string, unknown>)[
          String(args.callId)
        ] = args.error ? { error: args.error } : { text: args.text };
        return Promise.resolve(null);
      // textus:// links waiting for a window: `window.__devPluginUris`, taken once.
      case "plugin_take_uris": {
        const links = (w.__devPluginUris ?? []) as string[];
        w.__devPluginUris = [];
        return Promise.resolve(links);
      }
      case "plugin_uninstall": {
        w.__devPlugins = installed.filter((p) => p.id !== id);
        delete pluginState.plugins[id];
        // Its global data and secrets go with it; a project's stays.
        const stores = (w.__devPluginStore ?? {}) as Record<string, unknown>;
        delete stores[`${id}|global|`];
        forgetShimSecrets(id);
        return Promise.resolve(null);
      }
      // A plugin Textus AI wrote: listed with its files, over an earlier
      // version of the same id.
      case "plugin_install_files": {
        const files = (args.files ?? []) as { path: string; text: string }[];
        const manifestFile = files.find((f) => f.path === "textus-plugin.json");
        if (!manifestFile)
          return Promise.reject("No textus-plugin.json among the files.");
        const pid = (JSON.parse(manifestFile.text) as { id: string }).id;
        if (!pid.startsWith("local."))
          return Promise.reject(
            `A plugin written in the conversation needs an id starting with local. - ${pid} is someone else's.`,
          );
        const written = {
          id: pid,
          dir: `/plugins/${pid}`,
          manifest: manifestFile.text,
          dev: false,
          files: Object.fromEntries(files.map((f) => [f.path, f.text])),
        };
        w.__devPlugins = [...installed.filter((p) => p.id !== pid), written];
        const listed: Record<string, unknown> = { ...written };
        delete listed.files;
        return Promise.resolve(listed);
      }
      case "plugin_install":
      case "plugin_load_dev":
        return Promise.reject("The dev shim installs no plugin from a file.");
      // A picker's answer (`window.__devPickPluginFolder`), and Export for
      // Publishing's requests in `window.__devPluginExports`.
      case "plugin_pick_package":
        return Promise.resolve(w.__devPickPluginFolder ?? null);
      case "plugin_export": {
        const asked = { id, publisher: args.publisher, folder: args.folder };
        ((w.__devPluginExports ??= []) as unknown[]).push(asked);
        const name = String(id).split(".").slice(1).join(".");
        return Promise.resolve(`${args.folder}/${args.publisher}.${name}`);
      }
      case "set_plugin_menu":
      case "set_tray_plugin_items":
        return Promise.resolve(null);
      // `window.__devPendingPluginCommand`: one picked in the tray, for this window.
      case "take_pending_plugin_command": {
        const command = (w.__devPendingPluginCommand as string) ?? null;
        w.__devPendingPluginCommand = null;
        return Promise.resolve(command);
      }
    }
    return null;
  }

  w.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    // Tauri's Windows form of an asset URL, which a test can answer with
    // page.route - a custom scheme never reaches the network.
    // No plugin files are served here: their frames get data: URLs.
    convertFileSrc: (path: string, protocol = "asset") =>
      protocol === "textus-plugin"
        ? ""
        : `http://${protocol}.localhost/${encodeURIComponent(path)}`,
    invoke: (
      cmd: string,
      args?: { event?: string; handler?: number; target?: { kind?: string } },
    ) => {
      log(cmd);
      // Pages and links opened in the browser: `window.__devLinks`.
      if (cmd.startsWith("open_") && /_(page|link)$/.test(cmd))
        ((w.__devLinks ??= []) as unknown[]).push({ cmd, ...args });
      // `window.__devFiles = { path: text }` is a disk of documents;
      // `__devFileMtimes = { path: ms }` their times (default 1).
      const files = w.__devFiles as Record<string, string> | undefined;
      const filePath = String((args as { path?: unknown })?.path ?? "");
      // A PDF or a picture (`__devBinaryFiles`) isn't text, as on disk.
      if (
        cmd === "read_text_file" &&
        filePath in ((w.__devBinaryFiles ?? {}) as Record<string, string>)
      )
        return Promise.reject("stream did not contain valid UTF-8");
      if (files && filePath in files) {
        if (cmd === "read_text_file") return Promise.resolve(files[filePath]);
        if (cmd === "file_mtime_ms")
          return Promise.resolve(
            (w.__devFileMtimes as Record<string, number> | undefined)?.[
              filePath
            ] ?? 1,
          );
      }
      // Native web pages, as frames laid where they would be.
      const page = webPageCommand(
        cmd,
        (args ?? {}) as Record<string, unknown>,
        (event, payload) =>
          (w.__devEmitTauriEvent as (event: string, payload: unknown) => void)(
            event,
            payload,
          ),
      );
      if (page) {
        ((w.__devInvokeCalls ??= []) as unknown[]).push({ cmd, ...args });
        return page;
      }
      // `window.__devInvokeResults = { cmd: value }` answers a command with a
      // canned value.
      const canned = w.__devInvokeResults as
        Record<string, unknown> | undefined;
      if (canned && cmd in canned) {
        // And records it in `window.__devInvokeCalls`.
        ((w.__devInvokeCalls ??= []) as unknown[]).push({ cmd, ...args });
        let value = canned[cmd] as {
          __reject?: unknown;
          __delay?: number;
          value?: unknown;
        } | null;
        // Settled against the request's blocks, as the backend settles a model's.
        if (cmd === "ai_agent_message") {
          const blocks = ((args as { blocks?: SentBlock[] } | undefined)
            ?.blocks ?? []) as SentBlock[];
          value =
            value && typeof value === "object" && "__delay" in value
              ? { ...value, value: settledTurns(blocks, value.value) }
              : (settledTurns(blocks, value) as typeof value);
        }
        // `{ __delay: ms, value }` answers only after a while - a picture
        // still being made - and `{ __delay: ms, __reject }` fails then.
        if (value && typeof value === "object" && "__delay" in value)
          return new Promise((resolve, reject) =>
            setTimeout(
              () =>
                "__reject" in value
                  ? reject(value.__reject)
                  : resolve(value.value),
              value.__delay,
            ),
          );
        // `{ __reject: message }` fails the command instead, for error UI.
        return value && typeof value === "object" && "__reject" in value
          ? Promise.reject(value.__reject)
          : Promise.resolve(value);
      }
      if (
        cmd === "plugin:event|listen" &&
        args?.event &&
        typeof args.handler === "number"
      ) {
        // Tauri's own drag events go to the webview, which a label alone
        // (AnyLabel) doesn't hear in the app either.
        if (!(
          args.event.startsWith("tauri://drag") &&
          args.target?.kind === "AnyLabel"
        ))
          listeners.set(args.event, [
            ...(listeners.get(args.event) ?? []),
            args.handler,
          ]);
        // Without a real id every unlisten is a no-op and stale StrictMode handlers
        // double-fire.
        return Promise.resolve(args.handler);
      }
      // The phone menu sends its commands to this same window.
      if (cmd === "plugin:event|emit_to" && args?.event) {
        const { event, payload } = args as { event: string; payload?: unknown };
        queueMicrotask(() =>
          (w.__devEmitTauriEvent as (e: string, p?: unknown) => void)(
            event,
            payload,
          ),
        );
        return Promise.resolve(null);
      }
      const stored = storageCommand(cmd, args as Record<string, unknown>);
      if (stored) return stored;
      const skill = skillCommand(cmd, args as Record<string, unknown>);
      if (skill) return skill;
      const theme = themeCommand(cmd, args as Record<string, unknown>);
      if (theme) return theme;
      const file = fsCommand(cmd, args as Record<string, unknown>);
      if (file) return file;
      const plugin = pluginCommand(cmd, args as Record<string, unknown>);
      if (plugin) return plugin;
      // Null would make the manual completion trigger throw an error dialog.
      if (cmd === "ai_complete") {
        return Promise.resolve(
          " and this ghost text is a canned dev-shim suggestion.",
        );
      }
      // One canned issue, so the underline and hover popover can be tried.
      if (cmd === "ai_grammar_check") {
        const paragraph =
          (args as unknown as { paragraph?: string })?.paragraph ?? "";
        return Promise.resolve(
          paragraph.length > 0
            ? [
                {
                  start: 0,
                  end: 1,
                  issue: "Canned dev-shim issue.",
                  suggestion: paragraph[0].toUpperCase(),
                },
              ]
            : [],
        );
      }
      // Null here crashes the tree when the reply is spread into turns. The reply
      // is drip-fed through `onEvent` (the live Channel here) to exercise streaming.
      if (cmd === "ai_agent_message") {
        const { message = "", onEvent } =
          (args as unknown as {
            message?: string;
            onEvent?: { onmessage?: (event: unknown) => void };
          }) ?? {};
        const reply = `Canned dev-shim reply to: ${message}`;
        return new Promise((resolve) => {
          let sent = 0;
          const timer = setInterval(() => {
            const next = Math.min(sent + 3, reply.length);
            onEvent?.onmessage?.({
              type: "delta",
              text: reply.slice(sent, next),
            } satisfies StreamEvent_Serialize);
            sent = next;
            if (sent >= reply.length) {
              clearInterval(timer);
              resolve([
                { kind: "User", text: message },
                { kind: "Assistant", text: reply },
              ]);
            }
          }, 30);
        });
      }
      // Real format handling (PDF, spreadsheets) needs the native side.
      if (cmd === "pick_attachment_file") {
        return Promise.resolve({
          kind: "text",
          name: "dev-shim-notes.md",
          content: "Canned dev-shim attachment content.",
          truncated: false,
        } satisfies ChatAttachment);
      }
      // Nothing waiting to open in this window.
      if (cmd === "take_pending_window_paths") return Promise.resolve([]);
      return Promise.resolve(null);
    },
    // As the real runtime: the callback is parked on window under `_<id>`.
    transformCallback: (cb?: (response: unknown) => void) => {
      const id = nextCallbackId++;
      w[`_${id}`] = cb ?? (() => {});
      return id;
    },
    unregisterCallback: () => {},
    plugins: {},
  };
  // Without this, StrictMode's remount leaves stale handlers that one emit
  // fires twice.
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (event: string, id: number) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((h) => h !== id),
      );
    },
  };
  // For an e2e mock that plays the model: calls named and settled as the backend would.
  w.__devNameCall = namedCall;
  w.__devSettle = settledArguments;
  // Whether anything listens for `event` yet: one sent before is lost.
  w.__devListening = (event: string) => (listeners.get(event) ?? []).length > 0;
  w.__devEmitTauriEvent = (event: string, payload?: unknown) => {
    for (const id of listeners.get(event) ?? []) {
      (w[`_${id}`] as ((e: unknown) => void) | undefined)?.({
        event,
        id,
        payload,
      });
    }
  };
}
