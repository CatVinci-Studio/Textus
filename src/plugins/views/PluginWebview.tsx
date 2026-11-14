import { contentZoom, watchContentZoom } from "../../engine/zoom/tab-zoom";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { connectFrame, sandboxedFrame, webviewDocument } from "../host/frames";
import { disposeWebview, resolveWebview, webviewMessage } from "../manager";
import {
  PLUGIN_MISSING,
  PLUGIN_OFF,
  pluginMayRun,
  pluginName,
  pluginRecord,
  pluginsSnapshot,
  subscribePlugins,
} from "../store/plugin-records";
import { grantedHosts } from "../store/permissions";
import type { CodeBlockSeen } from "../manager";
import { windowInfo } from "../store/plugin-records";
import { watchTheme, webviewThemeCss, windowIsDark } from "./theme-vars";
import { pageMenuEntries } from "./webview-menu";
import { openPageLink } from "./page-links";
import {
  clipboardText,
  textFieldItems,
} from "../../engine/controls/text-field-menu";
import { passZoomGesture, passZoomWheel } from "./frame-zoom";
import { createPortal } from "react-dom";
import { PluginProblem } from "./PluginProblem";
import {
  ContextMenu,
  type ContextMenuEntry,
} from "../../engine/controls/ContextMenu";
import { Presence } from "../../engine/motion/usePresence";
import {
  createWebview,
  setWebviewState,
  subscribeWebviews,
  webview,
  webviewConnected,
  webviewState,
  webviewHtml,
  type WebviewKind,
  type WebviewRecord,
} from "./webviews";

/** A webview's whole page, in the window's theme, and its frame's title. */
export function webviewPage(
  record: WebviewRecord,
  html: string,
  inDocument = record.kind === "codeBlock",
) {
  const plugin = pluginRecord(record.plugin);
  return {
    srcdoc: webviewDocument(html, {
      themeCss: webviewThemeCss(inDocument),
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
/** How long a Cut, Copy or Paste picked in the window's menu lets the page
 *  reach the clipboard (ms). */
const PICK_MS = 2000;
/** How long a page asked for too early waits to be asked again (ms). */
/** The text items a page may put in its menu (api.textItems), its own
 *  prefix before them ("text:cut"). */
const CLIPBOARD_ITEMS = ["cut", "copy", "paste"];
const RETRY_MS = 600;

/** A page's own zoom, kept current, and the way to tell the page when it
 *  changes (set once the page is up). */
function useZoomTeller(zoom: number) {
  const ownZoom = useRef(zoom);
  ownZoom.current = zoom;
  const tellZoom = useRef<(() => void) | null>(null);
  useEffect(() => tellZoom.current?.(), [zoom]);
  return { ownZoom, tellZoom };
}

/**
 * Where a plugin's webview is drawn: a sandboxed frame rebuilt on new HTML,
 * kept in the window's theme, its messages passed both ways.
 */
export function PluginWebview({
  id,
  className,
  fitHeight,
  zoom = 1,
  interfaceSize = false,
}: {
  id: string;
  className?: string;
  /** A block in the document drawn at the interface's size, not the
   *  document's text and zoom (an overview that widens instead). */
  interfaceSize?: boolean;
  /** The frame as tall as its page, up to this many pixels (asked as it
   *  changes, when a function). */
  fitHeight?: number | (() => number);
  /** A page in the document: its own size, times the document's zoom. */
  zoom?: number;
}) {
  const html = useSyncExternalStore(subscribeWebviews, () => webviewHtml(id));
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
  const { ownZoom, tellZoom } = useZoomTeller(zoom);
  useEffect(() => {
    const box = boxRef.current;
    const current = webview(id);
    if (!box || html === null || !current) return;
    // A code block's page is drawn in the document, at its text size and
    // zoom (unless it asks for the interface's); a settings page is only as
    // tall as its page, still interface.
    const inDocument = current.kind === "codeBlock";
    const page = webviewPage(current, html, inDocument && !interfaceSize);
    const docZoom = () => (interfaceSize ? 1 : contentZoom(frame));
    const frame = sandboxedFrame(page.srcdoc, page.title, { fullscreen: true });
    frame.className = "plugin-webview-frame";
    let endpoint: Parameters<typeof webviewConnected>[1] = null;
    // The clipboard is the page's only through a menu the window drew: a
    // Cut, Copy or Paste the user just picked there (the window's text menu,
    // or the text items a page put in its own menu), once.
    let picked: { action: unknown; until: number } | null = null;
    const pickedNow = (...actions: string[]) => {
      const ok =
        !!picked &&
        actions.includes(String(picked.action)) &&
        Date.now() < picked.until;
      picked = null;
      return ok;
    };
    // A menu the page asks for, at its point in the page: the value picked.
    const askMenu = (items: unknown, x: unknown, y: unknown, clip = false) =>
      new Promise<unknown>((resolve) => {
        let done = false;
        const finish = (value: unknown) => {
          if (done) return;
          done = true;
          const action = String(value ?? "").replace(/^.*:/, "");
          picked =
            clip || CLIPBOARD_ITEMS.includes(action)
              ? { action, until: Date.now() + PICK_MS }
              : null;
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
            true,
          ),
        textItems: ({ selected }: { selected: unknown }) =>
          textFieldItems(windowInfo().strings(), selected === true),
        clipboardWrite: ({ text }: { text: unknown }) =>
          pickedNow("copy", "cut")
            ? navigator.clipboard.writeText(String(text ?? "")).then(() => true)
            : false,
        clipboardRead: () => (pickedNow("paste") ? clipboardText() : ""),
        menuClose: () => closeMenuRef.current?.(),
        openLink: openPageLink,
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
          connected?.notify("zoom", {
            zoom: docZoom() * ownZoom.current,
          });
      },
    );
    // A page in the document draws at the document's zoom itself.
    tellZoom.current = inDocument
      ? () =>
          endpoint?.notify("zoom", {
            zoom: docZoom() * ownZoom.current,
          })
      : null;
    const stopZoom = inDocument
      ? watchContentZoom(() => tellZoom.current?.(), frame)
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
  }, [id, html, fitHeight, ownZoom, tellZoom, interfaceSize]);

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
        <Presence show={menu !== null}>
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
): {
  record: WebviewRecord | null;
  error: string | null;
  retry: () => void;
} {
  const [record, setRecord] = useState<WebviewRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { view, viewType } = target;
  // What the view was opened with counts only when it is made.
  const initialState = useRef(target.state);
  const initialTarget = useRef(target.target);
  const initialBlock = useRef(target.codeBlock);
  // Turned off, the page shows so; turned on again, it is made anew.
  // Before the plugins have loaded, it isn't known: tried as before.
  // Once they have, an uninstalled plugin's page is off too.
  const runs = useSyncExternalStore(
    subscribePlugins,
    () => !pluginsSnapshot().loaded || pluginMayRun(pluginRecord(plugin)),
  );
  useEffect(() => {
    if (!runs) {
      setRecord(null);
      setError(pluginRecord(plugin) ? PLUGIN_OFF : PLUGIN_MISSING);
      return;
    }
    const made = createWebview(plugin, kind, key, resource);
    // An answer for a page already let go (remounted, moved) is not this
    // one's: its "No webview" must not cover the page that replaced it.
    let current = true;
    setRecord(made);
    setError(null);
    resolveWebview(made, {
      view,
      viewType,
      state: initialState.current,
      target: initialTarget.current,
      codeBlock: initialBlock.current,
    }).catch((err) => {
      if (!current) return;
      const message = String((err as Error)?.message ?? err);
      // Asked before the plugin had set its page up: once more, quietly.
      if (attempt === 0 && /No webview provider/.test(message))
        window.setTimeout(() => setAttempt(1), RETRY_MS);
      else setError(message);
    });
    return () => {
      current = false;
      disposeWebview(made.id);
    };
  }, [plugin, kind, key, view, viewType, resource, attempt, runs]);
  return { record, error, retry: () => setAttempt((n) => n + 1) };
}

function WebviewOrProblem({
  record,
  error,
  retry,
  className,
}: {
  record: WebviewRecord | null;
  error: string | null;
  retry?: () => void;
  className?: string;
}) {
  if (error) return <PluginProblem error={error} retry={retry} />;
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
  const { record, error, retry } = useResolvedWebview(
    plugin,
    kind,
    `${plugin}:${view}`,
    { view },
  );
  return (
    <WebviewOrProblem
      record={record}
      error={error}
      retry={retry}
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
  if (error) return <PluginProblem error={error} />;
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
  const { record, error, retry } = useResolvedWebview(
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
        retry={retry}
        className="plugin-webview-tab"
      />
    </div>
  );
}
