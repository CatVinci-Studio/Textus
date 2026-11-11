import { fill } from "../../i18n/fill";
import { openPageLink } from "./page-links";
import { useEffect, useRef, useState } from "react";
import { connectFrame, sandboxedFrame } from "../host/frames";
import type { Endpoint } from "../host/rpc";
import {
  emitToWindow,
  listenToThisWindow,
  unlistenAll,
} from "../../platform/events";
import { thisWindow } from "../../platform/this-window";
import { windowIpc } from "../../platform/ipc";
import { popUpNativeMenu } from "../../platform/native-menu";
import { OPEN_AGENT_PANEL_EVENT } from "../../utils/events";
import { currentStrings } from "../../i18n/current";
import { ResizeGrip } from "./ResizeGrip";
import {
  FLOATING_DOWN,
  FLOATING_UP,
  type FloatingDown,
  type FloatingUp,
} from "./desktop-floating";
import "../plugins.css";

const query = new URLSearchParams(window.location.search);
const OWNER = query.get("owner") ?? "main";
const VIEW = query.get("key") ?? "";

type Up = FloatingUp extends infer U
  ? U extends FloatingUp
    ? Omit<U, "view">
    : never
  : never;

function up(payload: Up) {
  void emitToWindow(OWNER, FLOATING_UP, { view: VIEW, ...payload });
}

/**
 * The window a floating view floats in over the desktop: transparent, the
 * plugin's page in a sandboxed frame as in the editor window, dragged
 * anywhere and with a right-click menu as there, which also opens Textus. The editor window runs the plugin; this
 * one passes the frame's messages to it and its answers back.
 */
export function FloatingWindowApp() {
  const boxRef = useRef<HTMLDivElement>(null);
  const endpointRef = useRef<Endpoint | null>(null);
  // What the editor window says of the view: its name, icon and menu items.
  const [about, setAbout] = useState<{
    title: string;
    icon: string | null;
    menu: string[];
  }>({ title: "", icon: null, menu: [] });
  const { title, icon } = about;
  const [folded, setFolded] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0, scale: 1 });
  const t = currentStrings();

  useEffect(() => {
    document.documentElement.dataset.floatingWindow = "";
    let disconnect: (() => void) | null = null;
    const stop = unlistenAll(
      listenToThisWindow<FloatingDown>(FLOATING_DOWN, ({ payload }) => {
        if (payload.view !== VIEW) return;
        if (payload.kind === "folded") setFolded(payload.folded);
        else if (payload.kind === "notify")
          endpointRef.current?.notify(payload.method, payload.params);
        else if (payload.kind === "page") {
          setAbout({
            title: payload.title,
            icon: payload.icon,
            menu: payload.menu,
          });
          setSize(payload.size);
          setFolded(payload.folded);
          const box = boxRef.current;
          if (!box) return;
          disconnect?.();
          const frame = sandboxedFrame(payload.srcdoc, payload.title);
          frame.className = "plugin-webview-frame";
          disconnect = connectFrame(
            frame,
            {
              message: ({ message }: { message: unknown }) =>
                up({ kind: "message", message }),
              state: ({ state }: { state: unknown }) =>
                up({ kind: "state", state }),
              // Menus and the frame's height belong to the editor window.
              menu: () => null,
              menuClose: () => {},
              height: () => {},
              openLink: openPageLink,
            },
            () => payload.init,
            (connected) => {
              endpointRef.current = connected;
              up({ kind: "ready" });
            },
          );
          box.replaceChildren(frame);
        }
      }),
    );
    // Asks for the page; the editor window may have sent it before this
    // window listened.
    up({ kind: "hello" });
    return () => {
      stop();
      disconnect?.();
    };
  }, []);

  /** The system moves the window; where it stops is remembered. A dot
   *  that didn't move was clicked, and unfolds. */
  const drag = async (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const from = await windowIpc.floatingWindowPosition(VIEW);
    await thisWindow().startDragging();
    const at = await windowIpc.floatingWindowPosition(VIEW);
    if (!at || at[0] === null || at[1] === null) return;
    if (
      from &&
      Math.hypot(at[0] - (from[0] ?? 0), at[1] - (from[1] ?? 0)) < 3
    ) {
      up({ kind: folded ? "unfold" : "poke" });
      return;
    }
    up({ kind: "moved", x: at[0], y: at[1] });
  };

  if (folded)
    return (
      <button
        type="button"
        className="floating-view-dot"
        aria-label={fill(t.floatingUnfold, { name: title })}
        title={title}
        onPointerDown={(e) => void drag(e)}
      >
        {icon ? <img src={icon} alt="" /> : title.slice(0, 1)}
      </button>
    );

  // Which half of the screen it floats in: it grows toward the middle.
  const screenMiddle =
    ((window.screen as Screen & { availLeft?: number }).availLeft ?? 0) +
    window.screen.availWidth / 2;
  const side =
    window.screenX + window.innerWidth / 2 < screenMiddle ? "left" : "right";
  const resize = (scale: number) =>
    windowIpc.resizeFloatingWindow(
      VIEW,
      Math.round(size.width * scale),
      Math.round(size.height * scale),
      side === "right",
    );

  /** The system's menu: the window is too small to draw one in. */
  const menu = (event: React.MouseEvent) => {
    event.preventDefault();
    void popUpNativeMenu([
      ...about.menu.flatMap((label, index) => [
        { label, run: () => up({ kind: "menuItem", index }) },
      ]),
      ...(about.menu.length ? (["separator"] as const) : []),
      {
        label: t.floatingOpenApp,
        run: () => void windowIpc.showFloatingOwner(OWNER),
      },
      {
        label: t.floatingOpenAi,
        run: () => {
          void windowIpc.showFloatingOwner(OWNER).catch(() => undefined);
          void emitToWindow(OWNER, OPEN_AGENT_PANEL_EVENT, null);
        },
      },
      "separator",
      {
        label: fill(t.floatingToWindow, { name: title }),
        run: () => up({ kind: "toWindow" }),
      },
      {
        label: fill(t.floatingFold, { name: title }),
        run: () => up({ kind: "fold" }),
      },
      "separator",
      {
        label: fill(t.floatingClose, { name: title }),
        run: () => up({ kind: "close" }),
      },
    ]);
  };

  return (
    <div
      className="floating-view floating-window"
      role="dialog"
      aria-label={title}
    >
      <div ref={boxRef} className="plugin-webview plugin-webview-panel" />
      <div
        className="floating-view-handle"
        onPointerDown={(e) => void drag(e)}
        onContextMenu={menu}
      />
      <ResizeGrip
        side={side}
        {...size}
        onResize={(scale) => void resize(scale)}
        onDone={async (scale) => {
          await resize(scale);
          setSize((was) => ({ ...was, scale }));
          const at = await windowIpc.floatingWindowPosition(VIEW);
          if (at && at[0] !== null && at[1] !== null)
            up({ kind: "resized", scale, x: at[0], y: at[1] });
        }}
      />
    </div>
  );
}
