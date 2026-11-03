import { Suspense, useEffect, useState } from "react";
import { lazyComponent } from "../lazy/lazy-component";
import { lazyModule } from "../lazy/lazy-module";
import { listenToThisWindow, unlistenAll } from "../platform/events";
import { Presence } from "../ui/usePresence";

// Loaded the first time it opens: few open it, and never at startup.
const TextStylePanel = lazyComponent(
  lazyModule("text-style", () => import("../settings/TextStylePanel")),
  (m) => m.TextStylePanel,
);

/** View › Text Style…, over the document: its menu item opens and closes
 *  it, as does Esc or a click elsewhere. */
export function TextStyleLayer({ onMore }: { onMore: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(
    () =>
      unlistenAll(
        listenToThisWindow("menu-text-style", () => setOpen((was) => !was)),
      ),
    [],
  );
  return (
    <Presence show={open} exitMs={120}>
      {open && (
        <Suspense fallback={null}>
          <TextStylePanel
            onClose={() => setOpen(false)}
            onMore={() => {
              setOpen(false);
              onMore();
            }}
          />
        </Suspense>
      )}
    </Presence>
  );
}
