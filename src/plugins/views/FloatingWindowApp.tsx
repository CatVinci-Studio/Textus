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
import { currentStrings } from "../../i18n/current";
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
 * plugin's page in a sandboxed frame as in the editor window, and the same
 * bar to move, fold and close it. The editor window runs the plugin; this
 * one passes the frame's messages to it and its answers back.
 */
export function FloatingWindowApp() {
  const boxRef = useRef<HTMLDivElement>(null);
  const endpointRef = useRef<Endpoint | null>(null);
  const [title, setTitle] = useState("");
  const [folded, setFolded] = useState(false);
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
          setTitle(payload.title);
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
    up({ kind: "ready" });
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
      if (folded) up({ kind: "unfold" });
      return;
    }
    up({ kind: "moved", x: at[0], y: at[1] });
  };

  if (folded)
    return (
      <button
        type="button"
        className="floating-view-dot"
        aria-label={t.floatingUnfold.replace("{name}", title)}
        title={title}
        onPointerDown={(e) => void drag(e)}
      >
        {title.slice(0, 1)}
      </button>
    );

  return (
    <div
      className="floating-view floating-window"
      role="dialog"
      aria-label={title}
    >
      <div ref={boxRef} className="plugin-webview plugin-webview-panel" />
      <div className="floating-view-bar">
        <div
          className="floating-view-grip"
          role="button"
          tabIndex={-1}
          aria-label={t.floatingMove.replace("{name}", title)}
          onPointerDown={(e) => void drag(e)}
        />
        <button
          type="button"
          className="floating-view-action"
          aria-label={t.floatingToWindow.replace("{name}", title)}
          title={t.floatingToWindow.replace("{name}", title)}
          onClick={() => up({ kind: "toWindow" })}
        >
          ⇲
        </button>
        <button
          type="button"
          className="floating-view-action"
          aria-label={t.floatingFold.replace("{name}", title)}
          onClick={() => up({ kind: "fold" })}
        >
          –
        </button>
        <button
          type="button"
          className="floating-view-action"
          aria-label={t.floatingClose.replace("{name}", title)}
          onClick={() => up({ kind: "close" })}
        >
          ×
        </button>
      </div>
    </div>
  );
}
