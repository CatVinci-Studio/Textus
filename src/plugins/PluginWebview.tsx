import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { connectFrame, sandboxedFrame, webviewDocument } from "./frames";
import { dataUrl, readPluginFile, type PluginOrigin } from "./files";
import {
  disposeWebview,
  pluginName,
  pluginRecord,
  resolveWebview,
  webviewMessage,
} from "./manager";
import { grantedHosts } from "./permissions";
import { watchTheme, webviewThemeCss, windowIsDark } from "./theme-vars";
import {
  createWebview,
  setWebviewState,
  subscribeWebviews,
  webview,
  webviewConnected,
  webviewState,
  webviewsVersion,
  type WebviewKind,
  type WebviewRecord,
} from "./webviews";

/**
 * Where a plugin's webview is drawn: its page in a sandboxed frame
 * (frames.ts), rebuilt whenever the plugin sets new HTML, kept in the
 * window's theme, its messages passed to the plugin's code and back.
 */
export function PluginWebview({ id, className }: { id: string; className?: string }) {
  useSyncExternalStore(subscribeWebviews, webviewsVersion);
  const record = webview(id);
  const html = record?.html ?? null;
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    const current = webview(id);
    if (!box || html === null || !current) return;
    const plugin = pluginRecord(current.plugin);
    const frame = sandboxedFrame(
      webviewDocument(html, {
        themeCss: webviewThemeCss(),
        dark: windowIsDark(),
        frameHosts: grantedHosts(plugin?.granted ?? []),
      }),
      plugin ? pluginName(plugin) : current.plugin,
    );
    frame.className = "plugin-webview-frame";
    let endpoint: Parameters<typeof webviewConnected>[1] = null;
    const disconnect = connectFrame(
      frame,
      {
        message: ({ message }: { message: unknown }) => webviewMessage(id, message),
        state: ({ state }: { state: unknown }) => setWebviewState(current.key, state),
      },
      () => ({ state: webviewState(current.key) ?? null }),
      (connected) => {
        endpoint = connected;
        webviewConnected(id, connected);
      },
    );
    const stopTheme = watchTheme(() =>
      endpoint?.notify("theme", { css: webviewThemeCss(), dark: windowIsDark() }),
    );
    box.replaceChildren(frame);
    return () => {
      stopTheme();
      disconnect();
      webviewConnected(id, null);
      frame.remove();
    };
  }, [id, html]);

  return <div ref={boxRef} className={`plugin-webview ${className ?? ""}`} />;
}

/**
 * A webview a plugin fills on request - made when this mounts, given to
 * the plugin to fill (resolveWebview), and closed when this unmounts.
 */
function useResolvedWebview(
  plugin: string,
  kind: WebviewKind,
  key: string,
  target: { view?: string; viewType?: string },
  resource?: string,
): { record: WebviewRecord | null; error: string | null } {
  const [record, setRecord] = useState<WebviewRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { view, viewType } = target;
  useEffect(() => {
    const made = createWebview(plugin, kind, key, resource);
    setRecord(made);
    setError(null);
    resolveWebview(made, { view, viewType }).catch((err) =>
      setError(String((err as Error)?.message ?? err)),
    );
    return () => disposeWebview(made.id);
  }, [plugin, kind, key, view, viewType, resource]);
  return { record, error };
}

function WebviewOrProblem({
  record,
  error,
  className,
}: {
  record: WebviewRecord | null;
  error: string | null;
  className?: string;
}) {
  if (error) return <div className="plugin-webview-problem">{error}</div>;
  if (!record) return null;
  return <PluginWebview id={record.id} className={className} />;
}

/** A sidebar tab's panel, or a view in a tab of its own. */
export function PluginWebviewPanel({
  plugin,
  view,
  kind,
}: {
  plugin: string;
  view: string;
  kind: "sidebar" | "view";
}) {
  const { record, error } = useResolvedWebview(plugin, kind, `${plugin}:${view}`, { view });
  return <WebviewOrProblem record={record} error={error} className="plugin-webview-panel" />;
}

/** A plugin's own settings page (contributes.settingsPage), under its
 *  settings in Settings › Plugins. */
export function PluginSettingsWebview({ plugin }: { plugin: string }) {
  const { record, error } = useResolvedWebview(plugin, "settings", `${plugin}:settings`, {});
  return (
    <WebviewOrProblem record={record} error={error} className="plugin-webview-settings" />
  );
}

/** A tab showing a plugin's view or custom editor (DocTab.view). */
export function PluginTabPane({
  tabId,
  plugin,
  view,
  kind,
  resource,
}: {
  tabId: string;
  plugin: string;
  view: string;
  kind: "view" | "editor";
  resource?: string;
}) {
  const { record, error } = useResolvedWebview(
    plugin,
    kind,
    `tab:${tabId}`,
    kind === "editor" ? { viewType: view } : { view },
    resource,
  );
  return (
    <div className="plugin-tab-pane">
      <WebviewOrProblem record={record} error={error} className="plugin-webview-tab" />
    </div>
  );
}

/** A sidebar tab's icon: the plugin's SVG, drawn in the text colour. */
export function PluginTabIcon({
  plugin,
  origin,
  icon,
}: {
  plugin: string;
  origin: PluginOrigin;
  icon?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!icon) return;
    let live = true;
    readPluginFile(plugin, origin, icon)
      .then((bytes) => live && setUrl(dataUrl(icon, bytes)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [plugin, origin, icon]);
  return (
    <span
      className="plugin-tab-icon"
      aria-hidden="true"
      style={url ? { maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` } : undefined}
    />
  );
}
