import { Suspense, useSyncExternalStore, type ComponentType } from "react";
import { Tooltip } from "../../ui/Tooltip";
import {
  contextItemsVersion,
  contributedContextItems,
  subscribeContextItems,
} from "../../ui/context-menu-items";
import { pluginRecord } from "../store/plugin-records";
import { lazyComponent } from "../../lazy/lazy-component";
import { lazyModule } from "../../lazy/lazy-module";

/**
 * What draws plugins in the window, loaded the first time one is shown. The
 * rest of the app imports them from here, not from their modules.
 */
const webviews = lazyModule("plugin-webviews", () => import("./PluginWebview"));
const lists = lazyModule("plugin-lists", () => import("./PluginListView"));
const webPages = lazyModule("plugin-web-page", () => import("./WebPagePane"));

/** A lazy component that waits by itself: nothing shows until it loads. */
function waiting<P extends object>(Lazy: ComponentType<P>): ComponentType<P> {
  return function Waiting(props: P) {
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}

export const PluginTabPane = waiting(
  lazyComponent(webviews, (m) => m.PluginTabPane),
);
export const PluginWebviewPanel = waiting(
  lazyComponent(webviews, (m) => m.PluginWebviewPanel),
);
export const PluginSettingsWebview = waiting(
  lazyComponent(webviews, (m) => m.PluginSettingsWebview),
);
export const PluginTabIcon = waiting(
  lazyComponent(webviews, (m) => m.PluginTabIcon),
);
export const PluginCodeBlock = waiting(
  lazyComponent(webviews, (m) => m.PluginCodeBlock),
);
export const PluginListPane = waiting(
  lazyComponent(lists, (m) => m.PluginListPane),
);
export const WebPagePane = waiting(
  lazyComponent(webPages, (m) => m.WebPagePane),
);

/** The buttons plugins add over a sidebar view (menus "view/title"). */
export function ViewTitleActions({ view }: { view: string }) {
  useSyncExternalStore(subscribeContextItems, contextItemsVersion);
  const items = contributedContextItems("view/title", { path: null, view });
  if (!items.length) return null;
  return (
    <div className="sidebar-view-actions">
      {items.map((item, i) => {
        const origin = pluginRecord(item.plugin)?.origin;
        return (
          <Tooltip key={`${item.plugin}:${i}`} text={item.label}>
            <button
              className="sidebar-view-action"
              aria-label={item.label}
              onClick={item.onSelect}
            >
              {item.icon && origin ? (
                <PluginTabIcon
                  plugin={item.plugin}
                  origin={origin}
                  icon={item.icon}
                />
              ) : (
                item.label
              )}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
