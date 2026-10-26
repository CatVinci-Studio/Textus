import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import type { Event, UnlistenFn } from "@tauri-apps/api/event";
import { inBrowser } from "./runtime";

/** What the app asks of the window it runs in. */
export type ThisWindow = Pick<
  Window,
  | "label"
  | "close"
  | "destroy"
  | "minimize"
  | "toggleMaximize"
  | "isMaximized"
  | "isFullscreen"
  | "setFullscreen"
  | "setTitle"
  | "setAlwaysOnTop"
  | "startResizeDragging"
  | "outerPosition"
  | "outerSize"
  | "scaleFactor"
  | "onCloseRequested"
  | "onFocusChanged"
  | "onResized"
  | "onMoved"
  | "listen"
>;

const done = () => Promise.resolve();
const never = (): Promise<UnlistenFn> => Promise.resolve(() => {});

function onPage(name: "resize", handler: () => void): Promise<UnlistenFn> {
  window.addEventListener(name, handler);
  return Promise.resolve(() => window.removeEventListener(name, handler));
}

/** The browser tab as a window: it can't be closed, moved or resized from
 *  the page, so those do nothing. */
const browserWindow: ThisWindow = {
  label: "main",
  close: done,
  destroy: done,
  minimize: done,
  toggleMaximize: done,
  isMaximized: () => Promise.resolve(false),
  isFullscreen: () => Promise.resolve(!!document.fullscreenElement),
  setFullscreen: (on) =>
    on
      ? document.documentElement.requestFullscreen().catch(() => {})
      : document.exitFullscreen().catch(() => {}),
  setTitle: (title) => {
    document.title = title;
    return done();
  },
  setAlwaysOnTop: done,
  startResizeDragging: done,
  outerPosition: () =>
    Promise.resolve(new PhysicalPosition(window.screenX, window.screenY)),
  outerSize: () =>
    Promise.resolve(new PhysicalSize(window.outerWidth, window.outerHeight)),
  scaleFactor: () => Promise.resolve(window.devicePixelRatio),
  onCloseRequested: never,
  onFocusChanged: (handler) => {
    const tell = (payload: boolean) => () =>
      handler({ event: "focus", id: 0, payload } as Event<boolean>);
    const focus = tell(true);
    const blur = tell(false);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    return Promise.resolve(() => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
    });
  },
  onResized: (handler) =>
    onPage("resize", () =>
      handler({
        event: "resized",
        id: 0,
        payload: new PhysicalSize(window.innerWidth, window.innerHeight),
      } as Event<PhysicalSize>),
    ),
  onMoved: never,
  listen: never,
};

export function thisWindow(): ThisWindow {
  return inBrowser ? browserWindow : getCurrentWindow();
}
