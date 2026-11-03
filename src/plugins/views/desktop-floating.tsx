import { useEffect, useState, useSyncExternalStore } from "react";
import { windowIpc } from "../../platform/ipc";
import {
  emitToWindow,
  listenToThisWindow,
  unlistenAll,
} from "../../platform/events";
import { webviewMessage } from "../manager";
import { watchTheme, webviewThemeCss, windowIsDark } from "./theme-vars";
import { windowInfo } from "../store/plugin-records";
import { useResolvedWebview, webviewPage } from "./PluginWebview";
import {
  setWebviewState,
  subscribeWebviews,
  webview,
  webviewConnected,
  webviewState,
  webviewsVersion,
} from "./webviews";
import {
  closeFloating,
  moveFloating,
  touchFloating,
  type FloatingView,
} from "./floating-views";

/** The folded dot's size, on the desktop as in the window. */
export const DOT_SIZE = 36;

/** What the floating window tells the editor window that runs its plugin. */
export type FloatingUp =
  /** The window is up and asks for the page; again after a reload. */
  | { view: string; kind: "hello" }
  /** The page's frame is up: its messages can flow. */
  | { view: string; kind: "ready" }
  | { view: string; kind: "message"; message: unknown }
  | { view: string; kind: "state"; state: unknown }
  | { view: string; kind: "moved"; x: number; y: number }
  | { view: string; kind: "poke" }
  | { view: string; kind: "fold" | "unfold" | "close" | "toWindow" };

/** What the editor window sends down: the page, then the frame's calls. */
export type FloatingDown =
  | {
      view: string;
      kind: "page";
      srcdoc: string;
      title: string;
      /** The plugin's icon for the folded dot, or null. */
      icon: string | null;
      init: Record<string, unknown>;
      folded: boolean;
    }
  | { view: string; kind: "notify"; method: string; params: unknown }
  | { view: string; kind: "folded"; folded: boolean };

export const FLOATING_UP = "floating-up";
export const FLOATING_DOWN = "floating-down";

/**
 * A floating view on the desktop, seen from the editor window that runs
 * its plugin: the window opened where it was left, the plugin's page sent
 * to it, and its frame's messages passed both ways as if it were here.
 */
export function DesktopFloating({ view }: { view: FloatingView }) {
  const { record } = useResolvedWebview(
    view.plugin,
    "floating",
    `${view.plugin}:${view.view}`,
    { view: view.view },
  );
  useSyncExternalStore(subscribeWebviews, webviewsVersion);
  const html = record ? (webview(record.id)?.html ?? null) : null;
  const id = record?.id ?? null;
  const label = useFloatingWindow(view);

  useEffect(() => {
    if (!label || !id || html === null) return;
    const current = webview(id);
    if (!current) return;
    const down = (payload: FloatingDown) =>
      void emitToWindow(label, FLOATING_DOWN, payload);
    const page = webviewPage(current, html);
    const sendPage = () =>
      down({
        view: view.view,
        kind: "page",
        ...page,
        icon: view.icon,
        init: {
          state: webviewState(current.key) ?? null,
          language: windowInfo().language(),
        },
        folded: view.folded,
      });
    sendPage();
    const endpoint = {
      notify: (method: string, params?: unknown) =>
        down({ view: view.view, kind: "notify", method, params }),
      call: () => Promise.reject(new Error("A floating view takes no calls.")),
      close: () => {},
    };
    const stop = unlistenAll(
      listenToThisWindow<FloatingUp>(FLOATING_UP, ({ payload }) => {
        if (payload.view !== view.view) return;
        if (payload.kind === "hello") sendPage();
        else if (payload.kind === "ready") webviewConnected(id, endpoint);
        else if (payload.kind === "message")
          webviewMessage(id, payload.message);
        else if (payload.kind === "state")
          setWebviewState(current.key, payload.state);
      }),
    );
    const stopTheme = watchTheme(() =>
      endpoint.notify("theme", {
        css: webviewThemeCss(),
        dark: windowIsDark(),
      }),
    );
    return () => {
      stop();
      stopTheme();
      webviewConnected(id, null);
    };
    // The folded state is sent on its own; the page is sent once per HTML.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, id, html, view.view]);

  return null;
}

/** Opens the view's window where it was left, follows what the user does
 *  to it there, and closes it when the view closes. Answers its label. */
function useFloatingWindow(view: FloatingView): string | null {
  const label = useWindowLabel(view);
  useEffect(() => {
    if (!label) return;
    const size = view.folded ? [DOT_SIZE, DOT_SIZE] : [view.width, view.height];
    void windowIpc.resizeFloatingWindow(view.view, size[0], size[1]);
    void emitToWindow(label, FLOATING_DOWN, {
      view: view.view,
      kind: "folded",
      folded: view.folded,
    } satisfies FloatingDown);
  }, [label, view.view, view.folded, view.width, view.height]);
  useEffect(
    () =>
      unlistenAll(
        listenToThisWindow<FloatingUp>(FLOATING_UP, ({ payload }) => {
          if (payload.view !== view.view) return;
          if (payload.kind === "moved") {
            moveFloating(view.view, { x: payload.x, y: payload.y });
            touchFloating(view.view, "moved");
          } else if (payload.kind === "poke") touchFloating(view.view, "poke");
          else if (payload.kind === "fold" || payload.kind === "unfold")
            moveFloating(view.view, { folded: payload.kind === "fold" });
          else if (payload.kind === "close") closeFloating(view.view);
          else if (payload.kind === "toWindow")
            moveFloating(view.view, { place: "window" });
        }),
      ),
    [view.view],
  );
  return label;
}

function useWindowLabel(view: FloatingView): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const at =
      view.x === null || view.y === null ? null : { x: view.x, y: view.y };
    windowIpc
      .openFloatingWindow(view.view, at, view.width, view.height)
      .then((opened) => live && setLabel(opened))
      .catch(() => live && moveFloating(view.view, { place: "window" }));
    return () => {
      live = false;
      void windowIpc.closeFloatingWindow(view.view);
    };
    // Opened once; moving it is the user's, on the desktop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.view]);
  return label;
}
