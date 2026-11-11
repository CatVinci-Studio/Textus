import { CreateChat } from "../settings/pages/create-chat-lazy";
import { Suspense, useEffect, useState } from "react";
import { OPEN_CREATE_EVENT } from "../ai/chat/create-request";
import { lazyModule } from "../lazy/lazy-module";
import { lazyComponent } from "../lazy/lazy-component";
import {
  openExtensionsTab,
  openPluginPage,
} from "../settings/pages/extensions-tab";
import type { SettingsPanelProps } from "../settings/SettingsPanel";
import type { SettingsTabProps } from "../settings/tab/SettingsTab";
import { Presence } from "../engine/motion/usePresence";
import { isIOSApp } from "../platform/capabilities";
import { SHOW_SIDEBAR_TAB_EVENT } from "../utils/events";
import {
  OPEN_SETTINGS_PAGE_EVENT,
  settingsPageShown,
  showSettingsList,
  type SettingsPageRequest,
} from "../settings/settings-nav";
import { pluginName, pluginRecord } from "../plugins/store/plugin-records";
import { showPage, type PageRequest } from "./tabs/page-tabs";
import { namePageTabs } from "../document/doc-tabs";
import { settingsPage } from "../settings/settings-pages";

// A Settings tab is named by the page it shows: "Settings: General".
namePageTabs("settings", (state, t) => {
  const to = (state as PageRequest | undefined)?.to;
  const page = to && settingsPage(to === "updates" ? "about" : to);
  return page ? t.settingsPageTab.replace("{page}", page.label(t)) : null;
});
import type { TabState } from "./tabs/useTabState";
import type { Strings } from "../i18n/strings";

/** Settings and Plugins as tabs: everywhere but the iPhone and iPad. */
const inTabs = !isIOSApp;

// Settings' tab loads with Settings, warmed once the window is idle.
const SettingsTab = lazyComponent(
  lazyModule("settings-tab", () => import("../settings/tab/SettingsTab"), {
    warm: true,
  }),
  (m) => m.SettingsTab,
);

/** The Create tab's page: its conversation, filling the tab. */
export function CreateTabPage({ t }: { t: Strings }) {
  return (
    <Suspense fallback={null}>
      <div className="create-tab">
        <CreateChat t={t} />
      </div>
    </Suspense>
  );
}

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
      // Making a theme, a plugin or a skill with the AI: a tab of its own.
      if (inTabs) showPage(tabs, "create");
      else setState((s) => ({ open: "extensions", request: s.request + 1 }));
    };
    window.addEventListener(OPEN_CREATE_EVENT, open);
    // A page picked in the sidebar's list, or a search result there.
    const page = (e: Event) => {
      const { page, jump } = (e as CustomEvent<SettingsPageRequest>).detail;
      showPage(tabs, "settings", page, undefined, jump);
    };
    window.addEventListener(OPEN_SETTINGS_PAGE_EVENT, page);
    return () => {
      window.removeEventListener(OPEN_CREATE_EVENT, open);
      window.removeEventListener(OPEN_SETTINGS_PAGE_EVENT, page);
    };
  }, [tabs]);
  return {
    open: state.open,
    request: state.request,
    openSettings: () => {
      if (!inTabs) return request("general");
      showSettingsList();
      showPage(tabs, "settings", settingsPageShown());
    },
    openUpdates: () => {
      if (!inTabs) return request("updates");
      showSettingsList();
      showPage(tabs, "settings", "updates");
    },
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
    <Presence show={open !== null}>
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

/** The Settings tab's page, at the page last asked for (each request
 *  remounts it there). */
export function SettingsTabPage({
  request,
  ...props
}: SettingsTabProps & { request: PageRequest | null }) {
  return (
    <Suspense fallback={null}>
      <SettingsTab
        key={request?.at ?? 0}
        {...props}
        page={request?.to}
        jump={request?.jump as SettingsTabProps["jump"]}
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
