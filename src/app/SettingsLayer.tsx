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
type SettingsStart = "general" | "extensions";

/** Whether Settings is open, and at which page. */
export function useSettingsOpening() {
  const [open, setOpen] = useState<SettingsStart | null>(null);
  return {
    open,
    openSettings: () => setOpen("general"),
    openPluginSettings: () => {
      openExtensionsTab("plugins");
      setOpen("extensions");
    },
    close: () => setOpen(null),
  };
}

/** Settings over the window, loaded the first time it opens. */
export function SettingsLayer({
  opening,
  ...props
}: Omit<SettingsPanelProps, "onClose" | "initialCategory"> & {
  opening: ReturnType<typeof useSettingsOpening>;
}) {
  const { open, close } = opening;
  return (
    // The longest exit is the phone's: the page going back down.
    <Presence show={open !== null} exitMs={320}>
      {open && (
        <Suspense fallback={null}>
          <SettingsPanel {...props} onClose={close} initialCategory={open} />
        </Suspense>
      )}
    </Presence>
  );
}
