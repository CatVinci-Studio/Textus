import { Suspense, useSyncExternalStore } from "react";
import { lazyComponent } from "../../lazy/lazy-component";
import { lazyModule } from "../../lazy/lazy-module";
import { quickPickNow, subscribeQuickPick } from "./quick-pick-queue";

// The list loads with the first request: most windows never show one.
const QuickPickHost = lazyComponent(
  lazyModule("quick-pick", () => import("./quick-pick")),
  (m) => m.QuickPickHost,
);

/** Where a quick pick shows, once one is asked for. */
export function QuickPickSlot(props: { emptyLabel: string; okLabel: string }) {
  const asked = useSyncExternalStore(
    subscribeQuickPick,
    () => !!quickPickNow(),
  );
  if (!asked) return null;
  return (
    <Suspense fallback={null}>
      <QuickPickHost {...props} />
    </Suspense>
  );
}
