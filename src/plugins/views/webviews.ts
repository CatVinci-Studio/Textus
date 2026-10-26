import type { Endpoint } from "../host/rpc";

/**
 * The webviews plugins have open - a sidebar panel, a view or editor in a
 * tab, a settings page - by id. The plugin's host sets a webview's HTML
 * and posts to it (broker.ts); PluginWebview.tsx draws it in a sandboxed
 * frame and passes its messages back. A webview's state (setState) is
 * kept by its `key` - the view, or the tab - so a panel closed and opened
 * again finds it.
 */
export type WebviewKind =
  "sidebar" | "view" | "editor" | "settings" | "codeBlock";

export interface WebviewRecord {
  id: string;
  plugin: string;
  kind: WebviewKind;
  key: string;
  /** The page, its resources in place; null until the plugin sets it. */
  html: string | null;
  title?: string;
  /** The file a custom editor shows. */
  resource?: string;
  /** The frame's channel, while one is connected. */
  endpoint: Endpoint | null;
  /** Messages posted before the frame connected. */
  outbox: unknown[];
}

const records = new Map<string, WebviewRecord>();
const states = new Map<string, unknown>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  for (const listener of listeners) listener();
}

export function subscribeWebviews(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes whenever any webview does: for useSyncExternalStore. */
export function webviewsVersion(): number {
  return version;
}

let counter = 0;

export function createWebview(
  plugin: string,
  kind: WebviewKind,
  key: string,
  resource?: string,
): WebviewRecord {
  const record: WebviewRecord = {
    id: `wv-${++counter}-${Math.random().toString(36).slice(2, 8)}`,
    plugin,
    kind,
    key,
    html: null,
    resource,
    endpoint: null,
    outbox: [],
  };
  records.set(record.id, record);
  changed();
  return record;
}

export function webview(id: string): WebviewRecord | undefined {
  return records.get(id);
}

/** The webview shown under `key` (a tab's id, a view's), if any. */
export function webviewForKey(key: string): WebviewRecord | undefined {
  return [...records.values()].find((r) => r.key === key);
}

export function webviewsOf(plugin: string): WebviewRecord[] {
  return [...records.values()].filter((r) => r.plugin === plugin);
}

export function setWebviewHtml(id: string, html: string): void {
  const record = records.get(id);
  if (!record) return;
  record.html = html;
  changed();
}

export function setWebviewTitle(id: string, title: string): void {
  const record = records.get(id);
  if (!record) return;
  record.title = title;
  changed();
}

/** Posts to the frame, or keeps it for when the frame connects. */
export function postToWebview(id: string, message: unknown): void {
  const record = records.get(id);
  if (!record) return;
  if (record.endpoint) record.endpoint.notify("message", { message });
  else record.outbox.push(message);
}

/** The webview's frame once it is connected; null when it isn't within
 *  `ms`, or the webview goes. */
function whenConnected(id: string, ms: number): Promise<Endpoint | null> {
  const now = records.get(id)?.endpoint;
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = (endpoint: Endpoint | null) => {
      clearTimeout(timer);
      stop();
      resolve(endpoint);
    };
    const timer = setTimeout(() => done(null), ms);
    const stop = subscribeWebviews(() => {
      const record = records.get(id);
      if (!record) done(null);
      else if (record.endpoint) done(record.endpoint);
    });
  });
}

/** How the webview's page looks, for an export (WebviewApi.onExport): an
 *  SVG's markup or an image's data: URL; null when the page gives none
 *  within `ms`. */
export async function webviewPicture(
  id: string,
  theme: "light" | "dark",
  ms = 10_000,
): Promise<string | null> {
  const started = Date.now();
  const endpoint = await whenConnected(id, ms);
  if (!endpoint) return null;
  const left = ms - (Date.now() - started);
  const answer = await Promise.race([
    endpoint.call("export", { theme }).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), left)),
  ]);
  return typeof answer === "string" ? answer : null;
}

export function webviewConnected(id: string, endpoint: Endpoint | null): void {
  const record = records.get(id);
  if (!record) return;
  record.endpoint = endpoint;
  if (endpoint)
    for (const message of record.outbox.splice(0))
      endpoint.notify("message", { message });
  changed();
}

export function webviewState(key: string): unknown {
  return states.get(key);
}

export function setWebviewState(key: string, state: unknown): void {
  states.set(key, state);
}

/** Forgets a webview; its state stays with its key. */
export function removeWebview(id: string): WebviewRecord | undefined {
  const record = records.get(id);
  if (!record) return undefined;
  records.delete(id);
  record.endpoint = null;
  changed();
  return record;
}
