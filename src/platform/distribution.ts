import { distribution, type UpdateChannel } from "./ipc";
import type { Distribution } from "./ipc-app";
import type { Strings } from "../i18n/strings";

let cached: Promise<boolean> | null = null;
let known: Distribution = "direct";

/**
 * Whether this build may install its own updates: only the `direct` channel,
 * since a package manager owns its files. A failed lookup counts as `direct`.
 */
export function selfUpdateAllowed(): Promise<boolean> {
  cached ??= distribution
    .appDistribution()
    .then((d) => {
      known = d ?? "direct";
      return known === "direct";
    })
    .catch(() => true);
  return cached;
}

/**
 * The channel an update check asks. Package-manager builds report only
 * stable versions, which their package manager will also have.
 */
export function checkChannel(
  chosen: UpdateChannel,
  selfUpdate: boolean,
): UpdateChannel {
  return selfUpdate ? chosen : "stable";
}

/** Where a found update comes from when this build can't install it, once
 *  selfUpdateAllowed has answered: the package manager, or (portable) the
 *  site, unzipped over its folder. */
export function updateElsewhere(t: Strings): string {
  return known === "portable" ? t.updatePortable : t.updateViaPackageManager;
}
