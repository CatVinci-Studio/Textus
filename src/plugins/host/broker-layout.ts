import { grants } from "../api-permissions";
import type { PluginTabInfo } from "../app-bridge";
import { mayOpen } from "../may-open";
import { emitToThisWindow } from "../../platform/menu-events";
import { SHOW_SIDEBAR_TAB_EVENT } from "../../utils/events";
import { links } from "../../platform/ipc";
import { splitLayout } from "../../engine/layout/store";
import { panesOf } from "../../engine/layout/tree";
import { getWindowAccess, type PluginLocation } from "../app-bridge";
import { localize } from "../store/manifest";
import {
  closeFloating,
  floatingSide,
  openFloatingViews,
  showContribution,
} from "../views/floating-views";
import { webPageUrl } from "../views/web-page-url";
import { panelsState } from "../panels-state";
import {
  optionalStr,
  str,
  whereOf,
  type Params,
  type PluginScope,
} from "./broker-scope";

/** A location as the runtime sends it, checked. */
function locationOf(value: unknown): PluginLocation {
  if (!value || typeof value !== "object")
    throw new Error("A location is { path, ... }.");
  const v = value as Record<string, unknown>;
  const num = (x: unknown) =>
    typeof x === "number" && Number.isFinite(x) ? x : undefined;
  return {
    path: str(v.path, "location.path"),
    line: num(v.line),
    heading: optionalStr(v.heading),
    block: optionalStr(v.block),
    text: optionalStr(v.text),
    page: num(v.page),
    fragment: optionalStr(v.fragment),
  };
}

/** Whether `host` is one the plugin may reach (`network:<host>`). */
function hostGranted(p: PluginScope, host: string): boolean {
  const granted = p.info.granted;
  return (
    granted.includes("network:*") ||
    granted.includes(`network:${host}`) ||
    granted.some(
      (g) =>
        g.startsWith("network:*.") &&
        host.endsWith(g.slice("network:*".length)),
    )
  );
}

/**
 * A plugin's calls about tabs and panes: opening a file, a view, a web page or
 * a new document, and what the window shows. Opening a file needs files.read,
 * except the file a view of the plugin's already shows.
 */
/** A tab as plugin `id` may see it: what file or page it shows, and its
 *  name, only with a permission to read documents - its own views always. */
export function seenBy<T extends PluginTabInfo | null>(
  id: string,
  granted: readonly string[],
  tab: T,
): T {
  if (!tab || tab.plugin === id) return tab;
  const reads =
    grants(granted, "files.read") || granted.includes("editor.read");
  return reads ? tab : { ...tab, path: null, title: "" };
}

export function layoutHandlers(p: PluginScope) {
  const access = () => {
    const w = getWindowAccess();
    if (!w) throw new Error("The window isn't ready.");
    return w;
  };
  return {
    "layout.open": ({ location, where, asDocument }: Params) => {
      const place = locationOf(location);
      if (
        !mayOpen(
          p.id,
          p.info.granted,
          getWindowAccess()?.rootPath() ?? null,
          place.path,
        )
      )
        throw new Error("Only its own files and the folder's open.");
      const { path, ...rest } = place;
      access().openFile(path, {
        place: rest,
        asDocument: asDocument === true,
        where: whereOf(where),
      });
    },
    "layout.openView": ({ view, where, title, state }: Params) => {
      const id = str(view, "view");
      const declared = p.manifest().contributes.views.find((v) => v.id === id);
      if (!declared) throw new Error(`No view ${id} in the manifest.`);
      access().openPluginTab(
        {
          plugin: p.id,
          view: id,
          kind: declared.type === "list" ? "list" : "view",
          title:
            optionalStr(title) ??
            localize(p.manifest(), declared.title, p.deps.language()),
          state,
        },
        whereOf(where),
      );
    },
    // The plugin's own page - its settings, version, permissions - in its
    // tab: where a form that has no place in a sidebar goes.
    "layout.openSettings": () => {
      emitToThisWindow("menu-plugin-command", `plugin-settings:${p.id}`);
    },
    // A sidebar tab - any plugin's, or Files and Outline - shown.
    "layout.showSidebarTab": ({ id }: Params) => {
      window.dispatchEvent(
        new CustomEvent(SHOW_SIDEBAR_TAB_EVENT, { detail: str(id, "id") }),
      );
    },
    "layout.openWebPage": ({ url, where, title }: Params) => {
      const address = webPageUrl(str(url, "url"));
      if (!address) throw new Error("Only an https:// page opens in a tab.");
      const host = new URL(address).hostname;
      if (!hostGranted(p, host))
        throw new Error(`${p.id} was not granted network:${host}.`);
      access().openPluginTab(
        {
          plugin: p.id,
          view: "web",
          kind: "web",
          resource: address,
          title: optionalStr(title) ?? host,
        },
        whereOf(where),
      );
    },
    "layout.openUntitled": ({ text, where, title }: Params) =>
      access().openUntitled(
        str(text, "text"),
        optionalStr(title),
        whereOf(where),
      ),
    "layout.openExternal": ({ url }: Params) => {
      const address = str(url, "url");
      if (!/^https?:\/\//i.test(address))
        throw new Error("Only web links open in the browser.");
      return links.openWebLink(address);
    },
    "layout.openFloating": async ({ view }: Params) => {
      const id = str(view, "view");
      const declared = p
        .manifest()
        .contributes.floatingViews.find((v) => v.id === id);
      if (!declared) throw new Error(`No floating view ${id} in the manifest.`);
      await showContribution(
        p.id,
        declared,
        localize(p.manifest(), declared.title, p.deps.language()),
        p.manifest().icon ?? null,
      );
    },
    "layout.closeFloating": ({ view }: Params) => {
      const id = str(view, "view");
      if (openFloatingViews().some((v) => v.view === id && v.plugin === p.id))
        closeFloating(id);
    },
    "layout.floatingViews": () =>
      openFloatingViews()
        .filter((v) => v.plugin === p.id)
        .map((v) => ({
          view: v.view,
          open: true,
          visible: !v.folded,
          place: v.place,
          side: floatingSide(v),
        })),
    "layout.activeTab": () =>
      seenBy(p.id, p.info.granted, access().activeTab()),
    "layout.tabs": () =>
      access()
        .tabs()
        .map((tab) => seenBy(p.id, p.info.granted, tab)),
    "layout.panels": () => panelsState(),
    "layout.split": () => {
      // The outermost way the panes run, and each pane's tab in front.
      const layout = splitLayout();
      return layout
        ? {
            direction: layout.root.direction,
            panes: panesOf(layout.root).map((p) => p.front),
          }
        : { direction: null, panes: [] };
    },
  };
}
