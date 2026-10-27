import { distribution, type UpdateChannel } from "./ipc";

let cached: Promise<boolean> | null = null;

/**
 * Whether this build may install its own updates: only the `direct` channel,
 * since a package manager owns its files. A failed lookup counts as `direct`.
 */
export function selfUpdateAllowed(): Promise<boolean> {
  cached ??= distribution
    .appDistribution()
    .then((d) => (d ?? "direct") === "direct")
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
