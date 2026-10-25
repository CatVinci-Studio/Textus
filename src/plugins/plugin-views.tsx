import { Suspense, type ComponentType } from "react";
import { lazyComponent } from "../lazy/lazy-component";
import { lazyModule } from "../lazy/lazy-module";

/**
 * What draws plugins in the window - their webviews (panels, tabs, code
 * blocks, settings pages), their lists and their web pages - loaded the
 * first time one is shown, never with the window (lazy-module.ts). The
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
