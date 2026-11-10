import { Suspense, useEffect, useState } from "react";
import { OPEN_CREATE_EVENT } from "../ai/chat/create-request";
import { lazyModule } from "../lazy/lazy-module";
import { lazyComponent } from "../lazy/lazy-component";
import {
  openExtensionsTab,
  openPluginPage,
} from "../settings/pages/extensions-tab";
import type { SettingsPanelProps } from "../settings/SettingsPanel";
import { Presence } from "../engine/motion/usePresence";
import { isIOSApp } from "../platform/capabilities";
import { SHOW_SIDEBAR_TAB_EVENT } from "../utils/events";
import { pluginName, pluginRecord } from "../plugins/manager";
import { showPage, type PageRequest } from "./tabs/page-tabs";
import type { TabState } from "./tabs/useTabState";
import type { Strings } from "../i18n/strings";

/** Settings and Plugins as tabs: everywhere but the iPhone and iPad. */
const inTabs = !isIOSApp;

// A plugin's tab loads on first open.
const PluginTab = lazyComponent(
  lazyModule("plugin-tab", () => import("../settings/pages/PluginTab")),
  (m) => m.PluginTab,
);

/** A plugin's name, for its tab. */
const pluginTitle = (id: string) => {
  const record = pluginRecord(id);
  return record ? pluginName(record) : id;
};

// Settings loads on first open, warmed once the window is idle.
const SettingsPanel = lazyComponent(
  lazyModule("settings", () => import("../settings/SettingsPanel"), {
    warm: true,
  }),
  (m) => m.SettingsPanel,
);

/** The page Settings opens at: General, or Plugins from that menu. */
/** Where Settings opens: a page, or "updates" - About, checking. */
type SettingsStart = "general" | "extensions" | "updates";

/** Whether Settings is open, and at which page. Each request counts, so
 *  one made while Settings is open goes to its page from wherever it was.
 *  On the desktop Settings and Plugins are tabs (page-tabs.tsx): a request
 *  brings the tab to the front, at its page; the iPhone's and iPad's
 *  Settings stays a sheet over the window. */
export function useSettingsOpening(tabs: TabState) {
  const [state, setState] = useState<{
    open: SettingsStart | null;
    request: number;
  }>({ open: null, request: 0 });
  const request = (open: SettingsStart | null) =>
    setState((s) => ({ open, request: s.request + 1 }));
  // A request for Create no open tab took: Extensions, on Create, which
  // takes it as it mounts.
  useEffect(() => {
    const open = () => {
      openExtensionsTab("create");
      if (inTabs) showPage(tabs, "settings", "extensions");
      else setState((s) => ({ open: "extensions", request: s.request + 1 }));
    };
    window.addEventListener(OPEN_CREATE_EVENT, open);
    return () => window.removeEventListener(OPEN_CREATE_EVENT, open);
  }, [tabs]);
  return {
    open: state.open,
    request: state.request,
    openSettings: () =>
      inTabs ? showPage(tabs, "settings") : request("general"),
    openUpdates: () =>
      inTabs ? showPage(tabs, "settings", "updates") : request("updates"),
    openPluginSettings: (id?: string) => {
      // A plugin's page in its tab; the list itself is the sidebar's.
      if (inTabs)
        return id
          ? showPage(tabs, "plugins", id, pluginTitle(id))
          : window.dispatchEvent(
              new CustomEvent(SHOW_SIDEBAR_TAB_EVENT, { detail: "plugins" }),
            );
      if (id) openPluginPage(id);
      else openExtensionsTab("plugins");
      request("extensions");
    },
    close: () => request(null),
  };
}

/** Settings over the window, loaded the first time it opens. */
export function SettingsLayer({
  opening,
  ...props
}: Omit<SettingsPanelProps, "onClose" | "initialCategory"> & {
  opening: ReturnType<typeof useSettingsOpening>;
}) {
  const { open, request, close } = opening;
  return (
    // The longest exit is the phone's: the page going back down.
    <Presence show={open !== null} exitMs={320}>
      {open && (
        <Suspense fallback={null}>
          <SettingsPanel
            key={request}
            {...props}
            onClose={close}
            initialCategory={open}
          />
        </Suspense>
      )}
    </Presence>
  );
}

/** The Settings tab's page: Settings drawn in the tab, at the page last
 *  asked for (each request remounts it there). */
export function SettingsTabPage({
  request,
  ...props
}: Omit<SettingsPanelProps, "onClose" | "initialCategory" | "inTab"> & {
  request: PageRequest | null;
}) {
  return (
    <Suspense fallback={null}>
      <SettingsPanel
        key={request?.at ?? 0}
        {...props}
        inTab
        onClose={() => {}}
        initialCategory={request?.to ?? "general"}
      />
    </Suspense>
  );
}

/** A plugin's tab: the page of the plugin last asked for. */
export function PluginTabPage({
  request,
  t,
}: {
  request: PageRequest | null;
  t: Strings;
}) {
  return (
    <Suspense fallback={null}>
      <PluginTab t={t} id={request?.to ?? null} />
    </Suspense>
  );
}
