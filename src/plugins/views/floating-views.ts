import { emitPluginEvent } from "../app-bridge";
import { windowIpc } from "../../platform/ipc";
import { thisWindow } from "../../platform/this-window";
import { setFloatingCount } from "./floating-presence";
import { dataUrl, readPluginFile } from "../store/files";
import { contributedContextItems } from "../../ui/context-menu-items";
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
  /** The plugin's icon (a data: URL) for the folded dot; null for none. */
  icon: string | null;
  /** Where its manifest allows it. */
  allowed: FloatingPlace;
  /** Where it is now. */
  place: "desktop" | "window";
  /** Its top-left corner as a fraction of the window (in the window), or
   *  in screen points (on the desktop); null until first placed. */
  x: number | null;
  y: number | null;
  folded: boolean;
  /** The user's resize, kept in proportion: 1 is the manifest's size. */
  scale: number;
}

/** How far the user may shrink or grow a view. */
export const MIN_SCALE = 0.6;
export const MAX_SCALE = 1.4;

export function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Its size now, in points. */
export function floatingSize(view: FloatingView): [number, number] {
  return [
    Math.round(view.width * view.scale),
    Math.round(view.height * view.scale),
  ];
}

/** What a plugin hears when its view opens, closes, folds or moves. */
export interface FloatingChange {
  view: string;
  open: boolean;
  /** False while folded, so the page can stop its animations. */
  visible: boolean;
  place: "desktop" | "window";
  /** The half of the window, or of the screen, it sits in: a character
   *  there can face the middle. */
  side: "left" | "right";
}

/** A click, a few quick ones (petting), or a drag that moved it. */
export type FloatingTouch = "poke" | "pet" | "moved";

const KEY = "textus.floatingViews";
const open = new Map<string, FloatingView>();
const listeners = new Set<() => void>();
let version = 0;

type Saved = Pick<FloatingView, "place" | "x" | "y" | "folded"> & {
  scale?: number;
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

/** The screen's left edge among several (WebKit and Chromium know it). */
const screenLeft = () =>
  (window.screen as Screen & { availLeft?: number }).availLeft ?? 0;

/** Left or right of the middle; unplaced views start by the right edge. */
export function floatingSide(view: FloatingView): "left" | "right" {
  if (view.x === null) return "right";
  const [x, room] =
    view.place === "window"
      ? [view.x * window.innerWidth, window.innerWidth]
      : [view.x - screenLeft(), window.screen.availWidth];
  return x + floatingSize(view)[0] / 2 < room / 2 ? "left" : "right";
}

function changed(view: FloatingView, isOpen: boolean) {
  version++;
  setFloatingCount(open.size);
  const { place, x, y, folded, scale } = view;
  save(view.view, { place, x, y, folded, scale, open: isOpen });
  for (const listener of listeners) listener();
  emitPluginEvent("floating", {
    plugin: view.plugin,
    view: view.view,
    open: isOpen,
    visible: isOpen && !view.folded,
    place: view.place,
    side: floatingSide(view),
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

const PET_MS = 1200;
let pokes: { view: string; at: number[] } = { view: "", at: [] };

/** The user touched a view: three clicks in a moment are petting. */
export function touchFloating(view: string, kind: "poke" | "moved") {
  const current = open.get(view);
  if (!current) return;
  let touch: FloatingTouch = kind;
  if (kind === "poke") {
    const now = Date.now();
    const recent = pokes.view === view ? pokes.at : [];
    pokes = { view, at: [...recent.filter((t) => now - t < PET_MS), now] };
    if (pokes.at.length >= 3) {
      touch = "pet";
      pokes = { view, at: [] };
    }
  }
  emitPluginEvent("floatingTouch", {
    plugin: current.plugin,
    view,
    kind: touch,
  });
}

/** The plugin's own items for its view's right-click menu
 *  (contributes.menus "floating/context"). */
export function floatingMenuItems(view: Pick<FloatingView, "plugin" | "view">) {
  return contributedContextItems("floating/context", {
    path: null,
    view: view.view,
  }).filter((item) => item.plugin === view.plugin);
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

/** Where a view goes when nothing was remembered: in the window, unless
 *  it floats only over the desktop and can here. */
function firstPlace(allowed: FloatingPlace, desktop: boolean) {
  return allowed === "desktop" && desktop ? "desktop" : "window";
}

export function showFloating(
  contribution: Omit<FloatingView, "place" | "x" | "y" | "folded" | "scale">,
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
    scale: clampScale(remembered?.scale ?? 1),
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

/** Moves, resizes, folds or unfolds a view, or sends it between the
 *  desktop and the window. */
export function moveFloating(
  view: string,
  patch: Partial<Pick<FloatingView, "x" | "y" | "folded" | "place" | "scale">>,
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
  /** The manifest's icon, a path in the plugin. */
  icon: string | null,
): Promise<FloatingView> {
  const iconUrl = icon
    ? await readPluginFile(plugin, "installed", icon)
        .then((bytes) => dataUrl(icon, bytes))
        .catch(() => null)
    : null;
  return showFloating(
    {
      plugin,
      view: view.id,
      title,
      width: view.width,
      height: view.height,
      icon: iconUrl,
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
  icon: string | null,
) {
  const remembered = rememberedOpen();
  for (const view of views)
    if (remembered.includes(view.id))
      await showContribution(plugin, view, title(view.title), icon);
}
