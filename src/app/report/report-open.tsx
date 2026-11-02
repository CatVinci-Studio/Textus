import { Suspense, useEffect, useState } from "react";
import type { Strings } from "../../i18n/strings";
import type { Settings } from "../../prefs/settings-types";
import { lazyModule } from "../../lazy/lazy-module";
import { lazyComponent } from "../../lazy/lazy-component";

// Help > Report a Problem: asked for here, at startup; the dialog itself
// loads the first time it is.
const ReportProblemDialog = lazyComponent(
  lazyModule("report-problem", () => import("./ReportProblem")),
  (m) => m.ReportProblemDialog,
);

const listeners = new Set<(open: boolean) => void>();

/** Help > Report a Problem. */
export function openReportProblem(): void {
  for (const listener of listeners) listener(true);
}

/** The window's Report a Problem dialog, loaded once it is first opened and
 *  kept after, so it closes with its motion. */
export function ReportProblemHost({
  t,
  settings,
}: {
  t: Strings;
  settings: Settings;
}) {
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    const listener = (next: boolean) => {
      setOpen(next);
      if (next) setAsked(true);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  if (!asked) return null;
  return (
    <Suspense fallback={null}>
      <ReportProblemDialog
        t={t}
        settings={settings}
        open={open}
        onClose={() => setOpen(false)}
      />
    </Suspense>
  );
}
