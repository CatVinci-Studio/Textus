import { fill } from "../../i18n/fill";
import type { Strings } from "../../i18n/strings";

/** An extension's counts as the catalog has them; absent when uncounted. */
interface InstallCounts {
  installs?: number | null;
  installs30?: number | null;
}

/** "1,234 installs · +120 in 30 days", in the UI language's digits; the
 *  month left out when nothing came in it; nothing when uncounted. */
export function installsText(counts: InstallCounts, t: Strings): string | null {
  if (counts.installs === undefined || counts.installs === null) return null;
  const all = fill(t.pluginInstalls, { n: counts.installs.toLocaleString() });
  return counts.installs30
    ? `${all} · ${fill(t.pluginInstalls30, { n: counts.installs30.toLocaleString() })}`
    : all;
}
