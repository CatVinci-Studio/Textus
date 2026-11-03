import { Suspense, useSyncExternalStore } from "react";
import { lazyComponent } from "../../lazy/lazy-component";
import { lazyModule } from "../../lazy/lazy-module";
import { floatingCount, subscribeFloatingCount } from "./floating-presence";

// Its own module: loaded once a plugin opens a floating view.
const FloatingViews = lazyComponent(
  lazyModule("floating-views", () => import("./FloatingViews")),
  (m) => m.FloatingViews,
);

/** Plugins' floating views, loaded only while one is open. */
export function FloatingViewsHost() {
  const open = useSyncExternalStore(subscribeFloatingCount, floatingCount);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <FloatingViews />
    </Suspense>
  );
}
