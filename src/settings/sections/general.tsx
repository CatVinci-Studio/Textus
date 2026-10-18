import { errorText } from "../../utils/error-text";
import { useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Strings } from "../../i18n/strings";
import { cli, updater, type UpdateChannel } from "../../platform/ipc";
import { flushPendingWrites } from "../../storage/pending-writes";
import { checkChannel, selfUpdateAllowed } from "../../platform/distribution";
import { canAutoUpdate } from "../../platform/capabilities";
import { useSettings } from "../SettingsContext";
import { Select } from "../../ui/Select";
import { SettingRow } from "./controls";
import { levisImport, type LevisImportStatus } from "../../platform/ipc";
import type { Lang } from "../../i18n/strings";
import { runLevisImport } from "../levis-import";

// The General category's sections beyond plain settings rows.

/**
 * The manual "Check for Updates" button, beside the links in Settings ›
 * General › About Textus (which shows the version). The background
 * check (useAppUpdate) is silent about being up to date and about errors;
 * a manual check is the opposite - the user asked, so "already latest" and
 * failures both get an explicit answer here. A package-manager build only
 * reports the new version - see platform/distribution.ts.
 */
export function UpdateButton({ t }: { t: Strings }) {
  const [phase, setPhase] = useState<
    "idle" | "checking" | "latest" | "available" | "downloading" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [update, setUpdate] = useState<Update | null>(null);
  const [selfUpdate, setSelfUpdate] = useState(true);
  const { settings } = useSettings();

  useEffect(() => {
    if (canAutoUpdate) void selfUpdateAllowed().then(setSelfUpdate);
  }, []);

  async function checkNow() {
    setPhase("checking");
    setMessage("");
    try {
      const allowed = await selfUpdateAllowed();
      const found = await updater.check(
        checkChannel(settings.updateChannel, allowed),
      );
      if (found) {
        setUpdate(found);
        setPhase("available");
        setMessage(
          selfUpdate
            ? `${t.updateAvailable} v${found.version}`
            : `${t.updateAvailable} v${found.version} ${t.updateViaPackageManager}`,
        );
      } else {
        setPhase("latest");
        setMessage(t.updateLatest);
      }
    } catch (err) {
      setPhase("error");
      setMessage(`${t.updateFailed} ${errorText(err)}`);
    }
  }

  async function install() {
    if (!update || !selfUpdate) return;
    setPhase("downloading");
    setMessage(t.updateDownloading);
    try {
      // Neither way out of here asks a window to close first. On Windows
      // downloadAndInstall never returns: it starts the installer and ends
      // the process (tauri-plugin-updater calls std::process::exit, which
      // also skips Rust's exit-time flush) - so what's held back goes now,
      // and Rust's own 250 ms write lands while the download runs.
      await flushPendingWrites();
      await update.downloadAndInstall();
      // macOS and Linux: anything changed during the download, then the
      // relaunch (which does flush Rust's files on its way out).
      await flushPendingWrites();
      await relaunch();
    } catch (err) {
      setPhase("error");
      setMessage(`${t.updateFailed} ${errorText(err)}`);
    }
  }

  // No updater on iOS: the App Store updates it.
  if (!canAutoUpdate) return null;
  const busy = phase === "checking" || phase === "downloading";
  const ready =
    selfUpdate && (phase === "available" || phase === "downloading");
  return (
    <>
      <button
        type="button"
        className="text-button settings-about-link"
        onClick={ready ? install : checkNow}
        disabled={busy}
      >
        {ready
          ? t.updateInstall
          : phase === "checking"
            ? t.updateChecking
            : t.updateCheckButton}
      </button>
      {/* The answer to the check, under the row of buttons. */}
      {message && (
        <div
          className={`settings-about-status${phase === "error" ? " settings-error" : ""}`}
          role="status"
        >
          {message}
        </div>
      )}
    </>
  );
}

/**
 * Stable or Beta, under the update button in About Textus. Beta also gets
 * release candidates, always the newest release of either kind; going back
 * to Stable keeps an installed release candidate until a newer stable
 * version exists (src-tauri/src/commands/update.rs). Hidden where the app
 * doesn't install its own updates: iOS (the App Store) and package-manager
 * builds such as the Arch package, which only report stable versions.
 */
export function UpdateChannelRow({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const [selfUpdate, setSelfUpdate] = useState<boolean | null>(null);

  useEffect(() => {
    if (canAutoUpdate) void selfUpdateAllowed().then(setSelfUpdate);
  }, []);

  if (!canAutoUpdate || !selfUpdate) return null;
  return (
    <div className="settings-about-channel">
      <SettingRow label={t.updateChannelLabel} hint={t.updateChannelHint}>
        <Select
          className="settings-select"
          aria-label={t.updateChannelLabel}
          value={settings.updateChannel}
          onChange={(e) =>
            setSettings({ updateChannel: e.target.value as UpdateChannel })
          }
        >
          <option value="stable">{t.updateChannelStable}</option>
          <option value="beta">{t.updateChannelBeta}</option>
        </Select>
      </SettingRow>
    </div>
  );
}

/** "Install the {command} command…" with the command set as code. */
function withCommand(label: string) {
  const [before, after = ""] = label.split("{command}");
  return (
    <>
      {before}
      <code className="settings-inline-code">textus</code>
      {after}
    </>
  );
}

/**
 * Startup already tries a silent, non-privileged install (works when
 * /usr/local/bin happens to be user-writable, e.g. via Homebrew). This row
 * is for the common case where that silently failed: it shows current
 * status and, on click, retries through an admin-privileged prompt.
 */
export function CliCommandSection({ t }: { t: Strings }) {
  const [installed, setInstalled] = useState(false);
  const [phase, setPhase] = useState<"idle" | "installing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cli.cliCommandStatus().then(setInstalled);
  }, []);

  async function install() {
    setPhase("installing");
    setError(null);
    try {
      await cli.installCliCommand();
      setInstalled(true);
      setPhase("idle");
    } catch (err) {
      setPhase("error");
      setError(errorText(err));
    }
  }

  return (
    <SettingRow
      label={withCommand(t.cliCommandLabel)}
      error={error && `${t.cliCommandFailed} ${error}`}
    >
      {!error && (
        <span className="settings-row-value">
          {installed ? t.cliCommandInstalled : t.cliCommandNotInstalled}
        </span>
      )}
      <button
        className="text-button settings-inline-button"
        onClick={install}
        disabled={phase === "installing"}
      >
        {phase === "installing"
          ? t.cliCommandInstalling
          : installed
            ? t.cliCommandReinstallButton
            : t.cliCommandInstallButton}
      </button>
    </SettingRow>
  );
}

/** Settings › General › About Textus: bring a Levis installation in (again) - the same
 *  flow the first launch offers (settings/levis-import.ts). Shown only
 *  where there is a Levis installation to read. */
export function LevisImportSection({ t, lang }: { t: Strings; lang: Lang }) {
  const [status, setStatus] = useState<LevisImportStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    levisImport
      .status()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  if (!status?.supported || status.items.length === 0) return null;
  return (
    <SettingRow label={t.levisImportRow}>
      <button
        className="text-button settings-inline-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await runLevisImport(t, lang, status);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t.levisImportButton}
      </button>
    </SettingRow>
  );
}
