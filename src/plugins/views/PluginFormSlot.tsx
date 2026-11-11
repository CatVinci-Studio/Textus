import { Suspense, useSyncExternalStore } from "react";
import { lazyComponent } from "../../lazy/lazy-component";
import { lazyModule } from "../../lazy/lazy-module";
import { pluginFormNow, subscribePluginForm } from "./plugin-form-queue";

// The dialog loads with a plugin's first form: most windows never show one.
const PluginFormHost = lazyComponent(
  lazyModule("plugin-form", () => import("./plugin-form")),
  (m) => m.PluginFormHost,
);

/** Where a plugin's form shows, once one asks. */
export function PluginFormSlot() {
  const asked = useSyncExternalStore(
    subscribePluginForm,
    () => !!pluginFormNow(),
  );
  if (!asked) return null;
  return (
    <Suspense fallback={null}>
      <PluginFormHost />
    </Suspense>
  );
}
