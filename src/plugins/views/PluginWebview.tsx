import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { connectFrame, sandboxedFrame, webviewDocument } from "../host/frames";
import { dataUrl, readPluginFile, type PluginOrigin } from "../store/files";
import {
  codeBlockChanged,
  disposeWebview,
  pluginName,
  pluginRecord,
  resolveWebview,
  webviewMessage,
} from "../manager";
import { grantedHosts } from "../store/permissions";
import { trackCodeBlock, untrackCodeBlock } from "../contributions/code-blocks";
import type { CodeBlockSeen } from "../manager";
import { windowInfo } from "../store/plugin-records";
import { watchTheme, webviewThemeCss, windowIsDark } from "./theme-vars";
import { pageMenuEntries } from "./webview-menu";
import { ContextMenu, type ContextMenuEntry } from "../../ui/ContextMenu";
import { Presence } from "../../ui/usePresence";
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

/** The tallest a code block's frame grows; past it, it scrolls. */
const MAX_CODE_BLOCK_HEIGHT = 1200;

/**
 * Where a plugin's webview is drawn: a sandboxed frame rebuilt on new HTML,
 * kept in the window's theme, its messages passed both ways.
 */
export function PluginWebview({
  id,
  className,
  fitHeight,
}: {
  id: string;
  className?: string;
  /** The frame as tall as its page, up to this many pixels. */
  fitHeight?: number;
}) {
  useSyncExternalStore(subscribeWebviews, webviewsVersion);
  const record = webview(id);
  const html = record?.html ?? null;
  const boxRef = useRef<HTMLDivElement>(null);
  const closeMenuRef = useRef<(() => void) | null>(null);
  // A menu the page asked for, drawn by the app over the page.
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuEntry[];
    close: () => void;
  } | null>(null);

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
        language: windowInfo().language(),
        l10n: plugin?.manifest?.l10n ?? {},
      }),
      plugin ? pluginName(plugin) : current.plugin,
    );
    frame.className = "plugin-webview-frame";
    let endpoint: Parameters<typeof webviewConnected>[1] = null;
    const disconnect = connectFrame(
      frame,
      {
        message: ({ message }: { message: unknown }) =>
          webviewMessage(id, message),
        state: ({ state }: { state: unknown }) =>
          setWebviewState(current.key, state),
        menu: ({ items, x, y }: { items: unknown; x: unknown; y: unknown }) =>
          new Promise<unknown>((resolve) => {
            let done = false;
            const finish = (value: unknown) => {
              if (done) return;
              done = true;
              setMenu(null);
              resolve(value);
            };
            const box = frame.getBoundingClientRect();
            closeMenuRef.current = () => finish(null);
            setMenu({
              x: box.left + (typeof x === "number" ? x : 0),
              y: box.top + (typeof y === "number" ? y : 0),
              items: pageMenuEntries(items, finish),
              close: () => finish(null),
            });
          }),
        menuClose: () => closeMenuRef.current?.(),
        height: ({ height }: { height: unknown }) => {
          if (fitHeight && typeof height === "number")
            frame.style.height = `${Math.min(Math.max(height, 24), fitHeight)}px`;
        },
      },
      () => ({
        state: webviewState(current.key) ?? null,
        language: windowInfo().language(),
      }),
      (connected) => {
        endpoint = connected;
        webviewConnected(id, connected);
      },
    );
    const stopTheme = watchTheme(() =>
      endpoint?.notify("theme", {
        css: webviewThemeCss(),
        dark: windowIsDark(),
      }),
    );
    box.replaceChildren(frame);
    return () => {
      stopTheme();
      disconnect();
      webviewConnected(id, null);
      frame.remove();
    };
  }, [id, html, fitHeight]);

  return (
    <>
      <div
        ref={boxRef}
        className={`plugin-webview ${className ?? ""}`}
        data-webview-id={id}
      />
      <Presence show={menu !== null} exitMs={120}>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            onClose={menu.close}
          />
        )}
      </Presence>
    </>
  );
}

/** A webview made when this mounts, given to the plugin to fill, and closed
 *  when this unmounts. */
function useResolvedWebview(
  plugin: string,
  kind: WebviewKind,
  key: string,
  target: {
    view?: string;
    viewType?: string;
    state?: unknown;
    target?: unknown;
    codeBlock?: CodeBlockSeen;
  },
  resource?: string,
): { record: WebviewRecord | null; error: string | null } {
  const [record, setRecord] = useState<WebviewRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { view, viewType } = target;
  // What the view was opened with counts only when it is made.
  const initialState = useRef(target.state);
  const initialTarget = useRef(target.target);
  const initialBlock = useRef(target.codeBlock);
  useEffect(() => {
    const made = createWebview(plugin, kind, key, resource);
    setRecord(made);
    setError(null);
    resolveWebview(made, {
      view,
      viewType,
      state: initialState.current,
      target: initialTarget.current,
      codeBlock: initialBlock.current,
    }).catch((err) => setError(String((err as Error)?.message ?? err)));
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
  const { record, error } = useResolvedWebview(
    plugin,
    kind,
    `${plugin}:${view}`,
    { view },
  );
  return (
    <WebviewOrProblem
      record={record}
      error={error}
      className="plugin-webview-panel"
    />
  );
}

/** A plugin's own settings page, under its settings. */
export function PluginSettingsWebview({ plugin }: { plugin: string }) {
  const { record, error } = useResolvedWebview(
    plugin,
    "settings",
    `${plugin}:settings`,
    {},
  );
  if (error) return <div className="plugin-webview-problem">{error}</div>;
  if (!record) return null;
  // As tall as the page: Settings scrolls, not a box inside it.
  return (
    <PluginWebview
      id={record.id}
      className="plugin-webview-settings"
      fitHeight={Infinity}
    />
  );
}

/** A tab showing a plugin's view or custom editor. */
export function PluginTabPane({
  tabId,
  plugin,
  view,
  kind,
  resource,
  state,
  target,
}: {
  tabId: string;
  plugin: string;
  view: string;
  kind: "view" | "editor";
  resource?: string;
  state?: unknown;
  target?: unknown;
}) {
  const { record, error } = useResolvedWebview(
    plugin,
    kind,
    `tab:${tabId}`,
    kind === "editor" ? { viewType: view, target } : { view, state },
    resource,
  );
  return (
    <div className="plugin-tab-pane">
      <WebviewOrProblem
        record={record}
        error={error}
        className="plugin-webview-tab"
      />
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
      style={
        url
          ? { maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` }
          : undefined
      }
    />
  );
}

/**
 * A code block a plugin draws in the document: made once in sight, told when
 * its source changes, and able to change it through `setSource`.
 */
export function PluginCodeBlock({
  plugin,
  widget,
  seen,
  setSource,
}: {
  plugin: string;
  /** The editor's widget it is drawn in: the same one while it lives. */
  widget: string;
  seen: CodeBlockSeen;
  setSource: (source: string) => boolean;
}) {
  const { record, error } = useResolvedWebview(plugin, "codeBlock", widget, {
    codeBlock: seen,
  });
  const latest = useRef(setSource);
  latest.current = setSource;
  useEffect(() => {
    if (!record) return;
    trackCodeBlock(record.id, {
      plugin,
      setSource: (source) => latest.current(source),
    });
    return () => untrackCodeBlock(record.id);
  }, [record, plugin]);
  // What it was made with is the plugin's already.
  const meta = JSON.stringify(seen.meta);
  const told = useRef({ source: seen.source, block: seen.block, meta });
  useEffect(() => {
    if (!record) return;
    const now = { source: seen.source, block: seen.block, meta };
    if (
      told.current.source === now.source &&
      told.current.block === now.block &&
      told.current.meta === now.meta
    )
      return;
    told.current = now;
    codeBlockChanged(record, { ...now, meta: JSON.parse(meta) });
  }, [record, seen.source, seen.block, meta]);
  if (error) return <div className="plugin-webview-problem">{error}</div>;
  if (!record) return null;
  return (
    <PluginWebview
      id={record.id}
      className="plugin-code-block-frame"
      fitHeight={MAX_CODE_BLOCK_HEIGHT}
    />
  );
}
