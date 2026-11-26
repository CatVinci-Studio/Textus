import { Suspense, useEffect, useState } from "react";
import type { Strings } from "../../i18n/strings";
import type { Settings } from "../../prefs/settings-types";
import { lazyModule } from "../../lazy/lazy-module";
import { lazyComponent } from "../../lazy/lazy-component";
import { createSubscribers } from "../../utils/store";

// Help > Report a Problem: asked for here, at startup; the dialog itself
// loads the first time it is.
export const ReportProblemDialog = lazyComponent(
  lazyModule("report-problem", () => import("./ReportProblem")),
  (m) => m.ReportProblemDialog,
);

const opening = createSubscribers<[open: boolean]>();

/** Help > Report a Problem. */
export function openReportProblem(): void {
  opening.publish(true);
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
    return opening.subscribe((next) => {
      setOpen(next);
      if (next) setAsked(true);
    });
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
