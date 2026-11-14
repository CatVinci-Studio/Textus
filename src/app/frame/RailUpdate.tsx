import { DownloadIcon } from "../../engine/controls/icons";
import { Tooltip } from "../../engine/controls/Tooltip";
import { emitToThisWindow } from "../../platform/menu-events";
import type { Strings } from "../../i18n/strings";
import { installUpdate, useAppUpdate } from "../app-update";
import { updateElsewhere } from "../../platform/distribution";

/**
 * A newer release, at the rail's foot over Settings, only while there is
 * one: a click installs it and relaunches (a package manager's build: its
 * page in Settings says how). Downloading, it waits; failed, it says why
 * and a click tries again.
 */
export function RailUpdate({ t }: { t: Strings }) {
  const update = useAppUpdate();
  if (update.status === "idle") return null;
  const tip = {
    available: `${t.updateAvailable} v${update.version} · ${
      update.selfUpdate ? t.updateInstall : updateElsewhere(t)
    }`,
    downloading: t.updateDownloading,
    error: `${t.updateFailed} ${update.error ?? ""}`,
  }[update.status];
  const act = () =>
    update.selfUpdate
      ? void installUpdate()
      : emitToThisWindow("menu-check-updates");
  return (
    <Tooltip text={tip} side="right">
      <button
        type="button"
        className="activity-rail-item activity-rail-update"
        aria-label={tip}
        data-state={update.status}
        disabled={update.status === "downloading"}
        onClick={act}
      >
        <DownloadIcon />
      </button>
    </Tooltip>
  );
}
