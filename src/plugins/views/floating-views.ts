import { emitPluginEvent } from "../app-bridge";
import { windowIpc } from "../../platform/ipc";
import { thisWindow } from "../../platform/this-window";
import { setFloatingCount } from "./floating-presence";
import type {
  FloatingPlace,
  FloatingViewContribution,
} from "../store/manifest";

/**
 * Plugins' floating views that are open (contributes.floatingViews): where
 * each one sits, whether it is folded to a dot, and where it floats - over
 * the desktop or in Textus's window. Kept per device: a view reopens where
 * the user left it.
 */
export interface FloatingView {
  plugin: string;
  view: string;
  title: string;
  width: number;
  height: number;
  /** Where its manifest allows it. */
  allowed: FloatingPlace;
  /** Where it is now. */
  place: "desktop" | "window";
  /** Its top-left corner as a fraction of the window (in the window), or
   *  in screen points (on the desktop); null until first placed. */
  x: number | null;
  y: number | null;
  folded: boolean;
}

/** What a plugin hears when its view opens, closes, folds or moves. */
export interface FloatingChange {
  view: string;
  open: boolean;
  /** False while folded, so the page can stop its animations. */
  visible: boolean;
  place: "desktop" | "window";
}

const KEY = "textus.floatingViews";
const open = new Map<string, FloatingView>();
const listeners = new Set<() => void>();
let version = 0;

type Saved = Pick<FloatingView, "place" | "x" | "y" | "folded"> & {
  open: boolean;
};

function saved(): Record<string, Saved> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function save(view: string, value: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...saved(), [view]: value }));
  } catch {
    // Private mode or full storage: the view still works, unremembered.
  }
}

function changed(view: FloatingView, isOpen: boolean) {
  version++;
  setFloatingCount(open.size);
  save(view.view, { ...view, open: isOpen });
  for (const listener of listeners) listener();
  emitPluginEvent("floating", {
    plugin: view.plugin,
    view: view.view,
    open: isOpen,
    visible: isOpen && !view.folded,
    place: view.place,
  });
}

let desktopHere: Promise<boolean> | null = null;

/** Whether this window may float views over the desktop: the platform can,
 *  and it is the main window, so two windows never float the same view. */
export function floatingOnDesktop(): Promise<boolean> {
  desktopHere ??= windowIpc
    .floatingDesktopSupported()
    .then((can) => can && thisWindow().label === "main")
    .catch(() => false);
  return desktopHere;
}

export function subscribeFloating(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function floatingVersion(): number {
  return version;
}

export function openFloatingViews(): FloatingView[] {
  return [...open.values()];
}

export function floatingView(view: string): FloatingView | undefined {
  return open.get(view);
}

/** Where a view goes when nothing was remembered: on the desktop where it
 *  can be, else in the window. */
function firstPlace(allowed: FloatingPlace, desktop: boolean) {
  return allowed === "window" || !desktop ? "window" : "desktop";
}

export function showFloating(
  contribution: Omit<FloatingView, "place" | "x" | "y" | "folded">,
  desktop: boolean,
): FloatingView {
  const existing = open.get(contribution.view);
  if (existing) {
    if (existing.folded) moveFloating(existing.view, { folded: false });
    return existing;
  }
  const remembered = saved()[contribution.view];
  const allowedHere = (place: "desktop" | "window") =>
    contribution.allowed === "either" || contribution.allowed === place;
  const place =
    remembered &&
    allowedHere(remembered.place) &&
    (remembered.place === "window" || desktop)
      ? remembered.place
      : firstPlace(contribution.allowed, desktop);
  const view: FloatingView = {
    ...contribution,
    place,
    x: remembered?.place === place ? remembered.x : null,
    y: remembered?.place === place ? remembered.y : null,
    folded: false,
  };
  open.set(view.view, view);
  changed(view, true);
  return view;
}

export function closeFloating(view: string) {
  const current = open.get(view);
  if (!current) return;
  open.delete(view);
  changed(current, false);
}

/** Moves, folds or unfolds a view, or sends it between the desktop and
 *  the window. */
export function moveFloating(
  view: string,
  patch: Partial<Pick<FloatingView, "x" | "y" | "folded" | "place">>,
) {
  const current = open.get(view);
  if (!current) return;
  const placeChanged = patch.place && patch.place !== current.place;
  const next: FloatingView = {
    ...current,
    ...patch,
    ...(placeChanged && patch.x === undefined ? { x: null, y: null } : {}),
  };
  open.set(view, next);
  changed(next, true);
}

/** A plugin turned off or removed: its views go. */
export function closeFloatingOf(plugin: string) {
  for (const view of [...open.values()])
    if (view.plugin === plugin) {
      open.delete(view.view);
      version++;
      setFloatingCount(open.size);
      for (const listener of listeners) listener();
    }
}

/** The views left open last time, to open again once their plugins run. */
export function rememberedOpen(): string[] {
  return Object.entries(saved())
    .filter(([, value]) => value.open)
    .map(([view]) => view);
}

/** A plugin's view, as its manifest declares it, shown. */
export async function showContribution(
  plugin: string,
  view: FloatingViewContribution,
  title: string,
): Promise<FloatingView> {
  return showFloating(
    {
      plugin,
      view: view.id,
      title,
      width: view.width,
      height: view.height,
      allowed: view.place,
    },
    await floatingOnDesktop(),
  );
}

/** The plugin's views left open last time, open again. */
export async function reopenFloating(
  plugin: string,
  views: FloatingViewContribution[],
  title: (value: string) => string,
) {
  const remembered = rememberedOpen();
  for (const view of views)
    if (remembered.includes(view.id))
      await showContribution(plugin, view, title(view.title));
}
