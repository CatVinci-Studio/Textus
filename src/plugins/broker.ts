import { resolveBlockEdit } from "../ai/doc-blocks";
import {
  releaseKeys,
  runEditorOp,
  setKeyCapture,
  type EditorOp,
  type KeyCapture,
} from "./editor-input";
import { outlineOf, removeStatusItem, setStatusItem } from "./status-items";
import { links } from "../platform/ipc";
import { showMessage, showPrompt } from "../ui/app-dialog";
import { EDIT_ACTIONS, type EditAction, type EditProposal } from "../ai/types";
import type { Strings } from "../i18n/strings";
import {
  getActiveDocument,
  getWindowAccess,
  onPluginEvent,
  type PluginEventMap,
} from "./app-bridge";
import { connectFrame, hostDocument, sandboxedFrame } from "./frames";
import { readPluginFile, withResources, type PluginOrigin } from "./files";
import { localize, type Permission, type PluginManifest } from "./manifest";
import { showQuickPick, type QuickPickItem } from "./quick-pick";
import { webPageUrl } from "./WebPagePane";
import {
  addHoverProvider,
  removeHoverProvider,
  type HoverCard,
} from "./hover-providers";
import { workspaceHandlers, type PluginScope } from "./broker-workspace";
import { layoutHandlers } from "./broker-layout";
import type { Endpoint } from "./rpc";
import { lazyModule, type LazyModule } from "../lazy/lazy-module";
import {
  postToWebview,
  setWebviewHtml,
  setWebviewTitle,
  webview,
} from "./webviews";

/**
 * The window's side of one running plugin (docs/design/plugins.md §4):
 * its host frame, and every call its code makes, checked against what the
 * user granted before anything is done - the privileged ones made in Rust,
 * which checks them again (src-tauri/src/plugins/).
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
  /** A setting's value: the user's, or the manifest's default. */
  setting(id: string, key: string): Promise<unknown>;
  /** Runs any command - the app's, or a plugin's. */
  runCommand(command: string, args: unknown[]): Promise<unknown>;
  /** A command the plugin registered beyond its manifest's. */
  addCommand(id: string, command: string): void;
  removeCommand(command: string): void;
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

/** The events a plugin can listen to, and the permission each needs. */
const PLUGIN_EVENT_NEEDS: Record<keyof PluginEventMap, Permission | null> = {
  didSave: "workspace.read",
  activeDocument: "document.read",
  root: "workspace.read",
  theme: null,
  language: null,
  settings: null,
  editorKey: "editor.input",
};

let proposalCounter = 0;

export class PluginHost {
  private frame: HTMLIFrameElement | null = null;
  private endpoint: Endpoint | null = null;
  private code: LazyModule<void> | null = null;
  private disconnect: (() => void) | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  private subscriptions = new Map<string, () => void>();
  private errors: number[] = [];
  private stopped = false;

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
    removeStatusItem(this.id);
    releaseKeys(this.id);
    removeHoverProvider(this.id);
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
    await withTimeout(
      this.endpoint.call("$activate"),
      START_MS,
      `Activating ${this.name}`,
    );
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

  private root(): string {
    this.need("workspace.read");
    const root = getWindowAccess()?.rootPath();
    if (!root) throw new Error("No folder is open.");
    return root;
  }

  private ownWebview(id: string) {
    const record = webview(id);
    if (!record || record.plugin !== this.id)
      throw new Error(`No webview ${id}.`);
    return record;
  }

  private readOwnFile = (rel: string) =>
    readPluginFile(this.id, this.info.origin, rel);

  /** What the workspace, network, storage and clipboard calls
   *  (broker-workspace.ts) need of this plugin. */
  private scope(): PluginScope {
    return {
      id: this.id,
      need: (permission) => this.need(permission),
      root: () => this.root(),
      ownWebview: (id) => this.ownWebview(id),
    };
  }

  /** The methods the plugin's code calls (runtime/host.js's `textus`). */
  private handlers() {
    const t = () => this.deps.strings();
    return {
      "host.error": () => {
        const now = Date.now();
        this.errors = [...this.errors.filter((at) => now - at < 60_000), now];
        if (this.errors.length > MAX_ERRORS_PER_MINUTE)
          this.deps.failed(this.id, t().pluginTooManyErrors);
      },
      "events.subscribe": ({ name }: { name: keyof PluginEventMap }) => {
        if (!(name in PLUGIN_EVENT_NEEDS)) throw new Error(`No event ${name}.`);
        const needs = PLUGIN_EVENT_NEEDS[name];
        if (needs) this.need(needs);
        if (this.subscriptions.has(name)) return;
        // A setting's change is told by the manager, to this plugin only.
        this.subscriptions.set(
          name,
          name === "settings" || name === "editorKey"
            ? () => {}
            : onPluginEvent(name, (data) => this.event(name, data)),
        );
      },
      "commands.register": ({ command }: { command: string }) => {
        if (!command.startsWith(`${this.id}.`))
          throw new Error(`A command must start with "${this.id}.".`);
        if (
          !this.info.manifest.contributes.commands.some(
            (c) => c.command === command,
          )
        )
          this.deps.addCommand(this.id, command);
      },
      "commands.unregister": ({ command }: { command: string }) => {
        if (
          !this.info.manifest.contributes.commands.some(
            (c) => c.command === command,
          )
        )
          this.deps.removeCommand(command);
      },
      "commands.execute": ({
        command,
        args,
      }: {
        command: string;
        args: unknown[];
      }) => this.deps.runCommand(command, args ?? []),
      "window.setStatusItem": ({
        id,
        text,
        tooltip,
        command,
      }: {
        id: string;
        text: string;
        tooltip?: string;
        command?: string;
      }) => {
        setStatusItem(this.id, String(id), { text, tooltip, command });
      },
      "window.removeStatusItem": ({ id }: { id: string }) => {
        removeStatusItem(this.id, String(id));
      },
      "window.showMessage": ({ text, tone }: { text: string; tone?: string }) =>
        showMessage(text, {
          title: this.name,
          tone: tone === "warning" || tone === "error" ? tone : "info",
        }),
      "window.showInput": (o: {
        prompt?: string;
        title?: string;
        value?: string;
      }) =>
        showPrompt(o.prompt ?? o.title ?? "", o.value ?? "", {
          title: this.name,
          okLabel: t().pluginOk,
          cancelLabel: t().pluginCancel,
        }),
      "window.showQuickPick": (o: {
        items: QuickPickItem[];
        placeholder?: string;
      }) =>
        showQuickPick(
          (o.items ?? []).map((item) =>
            typeof item === "string" ? { label: item, value: item } : item,
          ),
          o.placeholder ?? "",
        ),
      "window.openView": ({
        view,
        options,
      }: {
        view: string;
        options?: { title?: string; state?: unknown };
      }) => {
        const declared = this.info.manifest.contributes.views.find(
          (v) => v.id === view,
        );
        if (!declared) throw new Error(`No view ${view} in the manifest.`);
        getWindowAccess()?.openPluginTab({
          plugin: this.id,
          view,
          kind: "view",
          title:
            options?.title ??
            localize(this.info.manifest, declared.title, this.deps.language()),
          state: options?.state,
        });
      },
      "window.openWebPage": ({
        url,
        title,
      }: {
        url: string;
        title?: string;
      }) => {
        const address = webPageUrl(String(url));
        if (!address) throw new Error("Only an https:// page opens in a tab.");
        const host = new URL(address).hostname;
        const granted = this.info.granted;
        if (
          !granted.includes("network:*") &&
          !granted.includes(`network:${host}`) &&
          !granted.some(
            (p) =>
              p.startsWith("network:*.") &&
              host.endsWith(p.slice("network:*".length)),
          )
        )
          throw new Error(`${this.id} was not granted network:${host}.`);
        getWindowAccess()?.openPluginTab({
          plugin: this.id,
          view: "web",
          kind: "web",
          resource: address,
          title: title ?? host,
        });
      },
      "window.openExternal": ({ url }: { url: string }) => {
        if (!/^https?:\/\//i.test(url))
          throw new Error("Only web links open in the browser.");
        return links.openWebLink(url);
      },
      "window.openFile": ({
        path,
        heading,
      }: {
        path: string;
        heading?: string;
      }) => {
        this.need("workspace.read");
        getWindowAccess()?.openFile(path, heading);
      },
      "window.openUntitled": ({
        content,
        title,
      }: {
        content: string;
        title?: string;
      }) => getWindowAccess()?.openUntitled(content, title),
      "webview.setHtml": async ({
        webview: id,
        html,
      }: {
        webview: string;
        html: string;
      }) => {
        this.ownWebview(id);
        setWebviewHtml(id, await withResources(html, this.readOwnFile));
      },
      "webview.postMessage": ({
        webview: id,
        message,
      }: {
        webview: string;
        message: unknown;
      }) => {
        this.ownWebview(id);
        postToWebview(id, message);
        return true;
      },
      "webview.setTitle": ({
        webview: id,
        title,
      }: {
        webview: string;
        title: string;
      }) => {
        this.ownWebview(id);
        setWebviewTitle(id, title);
      },
      "document.getText": () => {
        this.need("document.read");
        return getActiveDocument()?.text() ?? null;
      },
      "document.getPath": () => {
        this.need("document.read");
        return getActiveDocument()?.path ?? null;
      },
      "document.getSelection": () => {
        this.need("document.read");
        return getActiveDocument()?.selection() ?? null;
      },
      "editor.registerHoverProvider": () => {
        this.need("document.read");
        addHoverProvider(this.id, (target) =>
          this.request<HoverCard | null>("$provideHover", { target }),
        );
      },
      "editor.captureKeys": (capture: KeyCapture | null) => {
        this.need("editor.input");
        setKeyCapture(
          this.id,
          capture && {
            mode: capture.mode === "all" ? "all" : "some",
            keys: Array.isArray(capture.keys) ? capture.keys.map(String) : [],
          },
          (key) => this.event("editorKey", key),
        );
      },
      "editor.exec": (op: EditorOp) => {
        this.need("editor.input");
        return runEditorOp(this.id, op);
      },
      "document.getBlocks": () => {
        this.need("document.read");
        return getActiveDocument()?.blocks() ?? null;
      },
      "document.getOutline": () => {
        this.need("document.read");
        const text = getActiveDocument()?.text();
        return text === undefined ? null : outlineOf(text);
      },
      "document.proposeEdit": (edit: Partial<EditProposal>) => {
        this.need("document.propose");
        const action = (edit.action ?? "insert_at_cursor") as EditAction;
        if (!EDIT_ACTIONS.includes(action))
          throw new Error(`No edit action ${action}.`);
        const doc = getActiveDocument();
        if (!doc) throw new Error("No document is open.");
        const text = typeof edit.text === "string" ? edit.text : undefined;
        const anchor =
          typeof edit.anchor === "string" ? edit.anchor : undefined;
        // Named by its blocks (document.getBlocks), as Textus AI names
        // them: filled in as the backend fills in the model's.
        const target =
          typeof edit.block === "string"
            ? resolveBlockEdit(
                doc.blocks(),
                {
                  action,
                  block: edit.block,
                  lastBlock:
                    typeof edit.lastBlock === "string"
                      ? edit.lastBlock
                      : undefined,
                  anchor,
                  text: text ?? "",
                },
                true,
              )
            : null;
        if (typeof edit.block === "string" && !target)
          throw new Error(
            `No block ${edit.block} in the document now, or its words aren't in it once.`,
          );
        const proposal: EditProposal = {
          action,
          text,
          ...(target ? { ...target, action: target.action as EditAction } : {}),
          reason: `${this.name}${typeof edit.reason === "string" ? `: ${edit.reason}` : ""}`,
        };
        return doc.propose(`plugin-${this.id}-${++proposalCounter}`, proposal);
      },
      "plugin.readFile": ({ path }: { path: string }) => this.readOwnFile(path),
      "settings.get": ({ key }: { key: string }) =>
        this.deps.setting(this.id, key),
      ...workspaceHandlers(this.scope()),
      ...layoutHandlers(),
    };
  }
}
