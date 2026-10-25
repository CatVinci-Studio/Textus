import { logPluginError, logPluginMessage } from "./plugin-log";
import type { Strings } from "../i18n/strings";
import {
  getWindowAccess,
  onPluginEvent,
  type PluginEventMap,
} from "./app-bridge";
import { connectFrame, sandboxedFrame } from "./frames";
import { hostDocument } from "./host-document";
import { readPluginFile, type PluginOrigin } from "./files";
import { localize, type Permission, type PluginManifest } from "./manifest";
import { fileHandlers } from "./broker-files";
import { layoutHandlers } from "./broker-layout";
import { editorHandlers, stopPluginEditor } from "./broker-editor";
import { metadataHandlers } from "./broker-metadata";
import { stopPluginUi, uiHandlers } from "./broker-ui";
import { viewHandlers } from "./broker-views";
import { forgetListViews } from "./list-views";
import { forgetWillSave } from "./will-save";
import { unwatchMetadata, watchMetadata } from "./metadata-cache";
import { str, type Params, type PluginScope } from "./broker-scope";
import type { Endpoint } from "./rpc";
import { lazyModule, type LazyModule } from "../lazy/lazy-module";
import { webview } from "./webviews";

/**
 * The window's side of one running plugin (docs/design/plugins.md §4):
 * its host frame, and every call its code makes, checked against what the
 * user granted before anything is done - the privileged ones made in Rust,
 * which checks them again (src-tauri/src/plugins/). The calls themselves
 * are the broker-*.ts handlers, one file per part of the API.
 */

/** A running plugin as the broker knows it. */
export interface PluginRuntimeInfo {
  manifest: PluginManifest;
  origin: PluginOrigin;
  granted: readonly Permission[];
}

/** What the broker needs of the plugin manager (manager.ts). */
export interface BrokerDeps {
  strings(): Strings;
  language(): string;
  appVersion: string;
  platform: string;
  dark(): boolean;
  /** A setting's value: the project's, the user's, or the default. */
  setting(id: string, key: string): Promise<unknown>;
  /** Sets one of the plugin's own settings, for every folder. */
  setSetting(id: string, key: string, value: unknown): Promise<void>;
  /** Runs any command - the app's, or a plugin's. */
  runCommand(command: string, args: unknown[]): Promise<unknown>;
  /** The plugin's code registered a command (`editor`: only with a
   *  document open). */
  commandRegistered(id: string, command: string, editor: boolean): void;
  commandUnregistered(id: string, command: string): void;
  /** What another plugin's activate returned: its function names, or
   *  null when it isn't on. */
  exportsOf(id: string): Promise<string[] | null>;
  callExport(id: string, name: string, args: unknown[]): Promise<unknown>;
  /** The plugin failed: stop it, turn it off, say why. */
  failed(id: string, reason: string): void;
}

/** How long a host has to load and to answer a ping. */
const START_MS = 10_000;
const PING_MS = 2_000;
const PING_EVERY_MS = 15_000;
/** Errors in a minute past which a plugin is turned off. */
const MAX_ERRORS_PER_MINUTE = 10;

/** Where the hosts' frames live: out of sight, still running. */
function hostsContainer(): HTMLElement {
  let box = document.getElementById("plugin-hosts");
  if (!box) {
    box = document.createElement("div");
    box.id = "plugin-hosts";
    box.className = "plugin-hosts";
    box.setAttribute("aria-hidden", "true");
    document.body.append(box);
  }
  return box;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} took too long`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** The events a plugin can listen to, and the permission each needs.
 *  `settings` and `editorKey` are told to one plugin by the manager and
 *  the editor; the rest come from the window (app-bridge.ts). */
const PLUGIN_EVENT_NEEDS: Record<keyof PluginEventMap, Permission | null> = {
  didSave: "files.read",
  activeDocument: "editor.read",
  documentChange: "editor.read",
  selection: "editor.read",
  activeTab: null,
  layout: null,
  root: "files.read",
  fileCreate: "files.read",
  fileChange: "files.read",
  fileRename: "files.read",
  fileDelete: "files.read",
  metadata: "files.read",
  theme: null,
  language: null,
  settings: null,
  editorKey: "editor.input",
};

export class PluginHost {
  private frame: HTMLIFrameElement | null = null;
  private endpoint: Endpoint | null = null;
  private code: LazyModule<void> | null = null;
  private disconnect: (() => void) | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  private subscriptions = new Map<string, () => void>();
  private errors: number[] = [];
  private stopped = false;
  /** What its activate returned: the functions other plugins may call. */
  exports: string[] = [];

  constructor(
    readonly info: PluginRuntimeInfo,
    private readonly deps: BrokerDeps,
  ) {}

  get id(): string {
    return this.info.manifest.id;
  }

  private get name(): string {
    return localize(
      this.info.manifest,
      this.info.manifest.name,
      this.deps.language(),
    );
  }

  /** Starts the host and activates the plugin, once: its code loads on
   *  first use, as the app's own heavy parts do (lazy-module.ts). A failed
   *  start turns the plugin off, which stops this broker. */
  start(): Promise<void> {
    this.code ??= lazyModule(`plugin:${this.id}`, () =>
      this.load().catch((err) => {
        this.deps.failed(this.id, String((err as Error)?.message ?? err));
        throw err;
      }),
    );
    return this.code.load();
  }

  /** A call to the plugin's code, starting it first. */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.start();
    if (!this.endpoint) throw new Error(`${this.name} is not running.`);
    return this.endpoint.call<T>(method, params);
  }

  /** Tells the plugin something, if it is running and listening. */
  event<K extends keyof PluginEventMap>(
    name: K,
    data: PluginEventMap[K],
  ): void {
    if (this.subscriptions.has(name))
      this.endpoint?.notify("$event", { name, data });
  }

  /** A message to the plugin's code that expects no answer, if it is
   *  running. */
  notify(method: string, params?: unknown): void {
    this.endpoint?.notify(method, params);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.code?.drop();
    if (this.pinger) clearInterval(this.pinger);
    const endpoint = this.endpoint;
    // Asked to tidy up, without waiting for it.
    endpoint?.call("$deactivate").catch(() => {});
    for (const stop of this.subscriptions.values()) stop();
    this.subscriptions.clear();
    stopPluginUi(this.id);
    stopPluginEditor(this.id);
    forgetListViews(this.id);
    forgetWillSave(this.id);
    unwatchMetadata(this.id);
    setTimeout(() => {
      this.disconnect?.();
      this.frame?.remove();
      this.frame = null;
      this.endpoint = null;
    }, 100);
  }

  private async load(): Promise<void> {
    const { manifest, origin } = this.info;
    const files = await Promise.all(
      (manifest.main ?? []).map((file) =>
        readPluginFile(manifest.id, origin, file),
      ),
    );
    const code = files
      .map((bytes) => new TextDecoder().decode(bytes))
      .join("\n;\n");
    if (this.stopped) throw new Error("Stopped");
    const frame = sandboxedFrame(hostDocument(code), manifest.id);
    this.frame = frame;
    const connected = new Promise<Endpoint>((resolve) => {
      this.disconnect = connectFrame(
        frame,
        this.handlers(),
        () => ({
          env: {
            pluginId: manifest.id,
            pluginVersion: manifest.version,
            language: this.deps.language(),
            appVersion: this.deps.appVersion,
            platform: this.deps.platform,
            theme: this.deps.dark() ? "dark" : "light",
            l10n: manifest.l10n,
          },
        }),
        resolve,
      );
    });
    hostsContainer().append(frame);
    this.endpoint = await withTimeout(
      connected,
      START_MS,
      `Starting ${this.name}`,
    );
    const exported = await withTimeout(
      this.endpoint.call<unknown>("$activate"),
      START_MS,
      `Activating ${this.name}`,
    );
    this.exports = Array.isArray(exported) ? exported.map(String) : [];
    let missed = 0;
    this.pinger = setInterval(() => {
      if (!this.endpoint) return;
      withTimeout(this.endpoint.call("$ping"), PING_MS, "ping").then(
        () => (missed = 0),
        () => {
          if (++missed >= 2)
            this.deps.failed(
              this.id,
              this.deps.strings().pluginStoppedAnswering,
            );
        },
      );
    }, PING_EVERY_MS);
  }

  private need(permission: Permission): void {
    if (!this.info.granted.includes(permission))
      throw new Error(`${this.id} was not granted ${permission}.`);
  }

  /** What the broker-*.ts handlers need of this plugin. */
  private scope(): PluginScope {
    return {
      id: this.id,
      info: this.info,
      deps: this.deps,
      name: () => this.name,
      t: () => this.deps.strings(),
      manifest: () => this.info.manifest,
      need: (permission) => this.need(permission),
      root: () => {
        this.need("files.read");
        const root = getWindowAccess()?.rootPath();
        if (!root) throw new Error("No folder is open.");
        return root;
      },
      ownWebview: (id) => {
        const record = webview(id);
        if (!record || record.plugin !== this.id)
          throw new Error(`No webview ${id}.`);
        return record;
      },
      readOwnFile: (rel) => readPluginFile(this.id, this.info.origin, rel),
      request: (method, params) => this.request(method, params),
      event: (name, data) => this.event(name, data),
    };
  }

  /** The methods the plugin's code calls (runtime/host.js's `textus`). */
  private handlers() {
    const scope = this.scope();
    return {
      "host.error": ({ message }: Params) => {
        logPluginError(this.id, String(message ?? "error"));
        const now = Date.now();
        this.errors = [...this.errors.filter((at) => now - at < 60_000), now];
        if (this.errors.length > MAX_ERRORS_PER_MINUTE)
          this.deps.failed(this.id, this.deps.strings().pluginTooManyErrors);
      },
      log: ({ level, message }: Params) => {
        const kind = level === "error" || level === "warn" ? level : "info";
        logPluginMessage(this.id, kind, String(message ?? ""));
      },
      "events.subscribe": ({ name }: Params) => {
        const event = str(name, "name") as keyof PluginEventMap;
        if (!(event in PLUGIN_EVENT_NEEDS))
          throw new Error(`No event ${event}.`);
        const needs = PLUGIN_EVENT_NEEDS[event];
        if (needs) this.need(needs);
        if (this.subscriptions.has(event)) return;
        if (event === "metadata") {
          const root = scope.root();
          watchMetadata(this.id, root);
        }
        this.subscriptions.set(
          event,
          event === "settings" || event === "editorKey"
            ? () => {}
            : onPluginEvent(event, (data) => this.event(event, data)),
        );
      },
      "plugin.readFile": ({ path }: Params) =>
        scope.readOwnFile(str(path, "path")),
      "settings.get": ({ key }: Params) =>
        this.deps.setting(this.id, str(key, "key")),
      "settings.set": ({ key, value }: Params) => {
        const k = str(key, "key");
        if (!this.info.manifest.contributes.settings.some((s) => s.key === k))
          throw new Error(`No setting ${k} in the manifest.`);
        return this.deps.setSetting(this.id, k, value);
      },
      "plugins.exports": ({ id }: Params) => this.deps.exportsOf(str(id, "id")),
      "plugins.call": ({ id, name, args }: Params) =>
        this.deps.callExport(
          str(id, "id"),
          str(name, "name"),
          Array.isArray(args) ? args : [],
        ),
      ...uiHandlers(scope),
      ...layoutHandlers(scope),
      ...viewHandlers(scope),
      ...editorHandlers(scope),
      ...fileHandlers(scope),
      ...metadataHandlers(scope),
    };
  }
}
