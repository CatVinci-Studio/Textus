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
import { clipboardText, textFieldItems } from "../../ui/text-field-menu";
import {
  contentZoom,
  passZoomGesture,
  passZoomWheel,
  watchContentZoom,
} from "./frame-zoom";
import { createPortal } from "react-dom";
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

/** A webview's whole page, in the window's theme, and its frame's title. */
export function webviewPage(record: WebviewRecord, html: string) {
  const plugin = pluginRecord(record.plugin);
  return {
    srcdoc: webviewDocument(html, {
      themeCss: webviewThemeCss(record.kind === "codeBlock"),
      dark: windowIsDark(),
      frameHosts: grantedHosts(plugin?.granted ?? []),
      language: windowInfo().language(),
      l10n: plugin?.manifest?.l10n ?? {},
      floating: record.kind === "floating",
      sidebar: record.kind === "sidebar",
    }),
    title: plugin ? pluginName(plugin) : record.plugin,
  };
}

/** The tallest a code block's frame grows: at most 70% of the window, so a
 *  long table or board scrolls inside and the note around it stays in
 *  view. */
const MAX_CODE_BLOCK_HEIGHT = 1200;
const CODE_BLOCK_SHARE = 0.7;
const codeBlockMax = () =>
  Math.min(
    MAX_CODE_BLOCK_HEIGHT,
    Math.round(window.innerHeight * CODE_BLOCK_SHARE),
  );

/**
 * Where a plugin's webview is drawn: a sandboxed frame rebuilt on new HTML,
 * kept in the window's theme, its messages passed both ways.
 */
export function PluginWebview({
  id,
  className,
  fitHeight,
  zoom = 1,
}: {
  id: string;
  className?: string;
  /** The frame as tall as its page, up to this many pixels (asked as it
   *  changes, when a function). */
  fitHeight?: number | (() => number);
  /** A page in the document: its own size, times the document's zoom. */
  zoom?: number;
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

  // The size the page draws at: its own times the document's.
  const ownZoom = useRef(zoom);
  ownZoom.current = zoom;
  const tellZoom = useRef<(() => void) | null>(null);
  useEffect(() => tellZoom.current?.(), [zoom]);
  useEffect(() => {
    const box = boxRef.current;
    const current = webview(id);
    if (!box || html === null || !current) return;
    const page = webviewPage(current, html);
    // A code block's page is drawn in the document, at its text size and
    // zoom; a settings page is only as tall as its page, still interface.
    const inDocument = current.kind === "codeBlock";
    const frame = sandboxedFrame(page.srcdoc, page.title);
    frame.className = "plugin-webview-frame";
    let endpoint: Parameters<typeof webviewConnected>[1] = null;
    // A menu the page asks for, at its point in the page: the value picked.
    const askMenu = (items: unknown, x: unknown, y: unknown) =>
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
      });
    const disconnect = connectFrame(
      frame,
      {
        message: ({ message }: { message: unknown }) =>
          webviewMessage(id, message),
        state: ({ state }: { state: unknown }) =>
          setWebviewState(current.key, state),
        menu: ({ items, x, y }: { items: unknown; x: unknown; y: unknown }) =>
          askMenu(items, x, y),
        // A text field's menu in the page, the window's own (text-field-menu.tsx).
        textMenu: ({
          x,
          y,
          selected,
        }: {
          x: unknown;
          y: unknown;
          selected: unknown;
        }) =>
          askMenu(
            textFieldItems(windowInfo().strings(), selected === true),
            x,
            y,
          ),
        textItems: ({ selected }: { selected: unknown }) =>
          textFieldItems(windowInfo().strings(), selected === true),
        clipboardWrite: ({ text }: { text: unknown }) =>
          navigator.clipboard.writeText(String(text ?? "")).then(() => true),
        clipboardRead: () => clipboardText(),
        menuClose: () => closeMenuRef.current?.(),
        // Told on as a right-click on the frame, for the menu around it.
        contextMenu: ({ x, y }: { x: unknown; y: unknown }) => {
          const at = frame.getBoundingClientRect();
          frame.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              button: 2,
              clientX: at.left + (typeof x === "number" ? x : 0),
              clientY: at.top + (typeof y === "number" ? y : 0),
            }),
          );
        },
        zoomWheel: (params: Parameters<typeof passZoomWheel>[1]) =>
          passZoomWheel(frame, params),
        zoomGesture: (params: Parameters<typeof passZoomGesture>[1]) =>
          passZoomGesture(frame, params),
        height: ({ height }: { height: unknown }) => {
          if (fitHeight && typeof height === "number")
            frame.style.height = `${Math.min(
              Math.max(height, 24),
              typeof fitHeight === "function" ? fitHeight() : fitHeight,
            )}px`;
        },
      },
      () => ({
        state: webviewState(current.key) ?? null,
        language: windowInfo().language(),
      }),
      (connected) => {
        endpoint = connected;
        webviewConnected(id, connected);
        if (inDocument)
          connected?.notify("zoom", { zoom: contentZoom() * ownZoom.current });
      },
    );
    // A page in the document draws at the document's zoom itself.
    tellZoom.current = inDocument
      ? () =>
          endpoint?.notify("zoom", { zoom: contentZoom() * ownZoom.current })
      : null;
    const stopZoom = inDocument
      ? watchContentZoom(() => tellZoom.current?.())
      : () => {};
    const stopTheme = watchTheme(() =>
      endpoint?.notify("theme", {
        css: webviewThemeCss(inDocument),
        dark: windowIsDark(),
      }),
    );
    box.replaceChildren(frame);
    return () => {
      stopTheme();
      stopZoom();
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
      {/* On the body: a page in a document sits inside its zoom, which
          would scale the menu's window coordinates a second time. */}
      {createPortal(
        <Presence show={menu !== null} exitMs={120}>
          {menu && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              items={menu.items}
              onClose={menu.close}
            />
          )}
        </Presence>,
        document.body,
      )}
    </>
  );
}

/** A webview made when this mounts, given to the plugin to fill, and closed
 *  when this unmounts. */
export function useResolvedWebview(
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

/** A sidebar tab's panel, a view in a tab of its own, or a floating view. */
export function PluginWebviewPanel({
  plugin,
  view,
  kind,
}: {
  plugin: string;
  view: string;
  kind: "sidebar" | "view" | "floating";
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
  zoom = 1,
}: {
  plugin: string;
  /** The editor's widget it is drawn in: the same one while it lives. */
  widget: string;
  seen: CodeBlockSeen;
  setSource: (source: string) => boolean;
  /** The block's own size (its fence's `zoom=`), times the document's. */
  zoom?: number;
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
      fitHeight={codeBlockMax}
      zoom={zoom}
    />
  );
}
