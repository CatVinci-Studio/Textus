import { Suspense, useState } from "react";
import { lazyModule } from "../lazy/lazy-module";
import { lazyComponent } from "../lazy/lazy-component";
import { openExtensionsTab } from "../settings/pages/extensions-tab";
import type { SettingsPanelProps } from "../settings/SettingsPanel";
import { Presence } from "../ui/usePresence";

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
 *  one made while Settings is open goes to its page from wherever it was. */
export function useSettingsOpening() {
  const [state, setState] = useState<{
    open: SettingsStart | null;
    request: number;
  }>({ open: null, request: 0 });
  const request = (open: SettingsStart | null) =>
    setState((s) => ({ open, request: s.request + 1 }));
  return {
    open: state.open,
    request: state.request,
    openSettings: () => request("general"),
    openUpdates: () => request("updates"),
    openPluginSettings: () => {
      openExtensionsTab("plugins");
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
