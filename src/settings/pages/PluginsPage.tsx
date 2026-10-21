import { useEffect, useState, useSyncExternalStore } from "react";
import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { SettingRow, ToggleRow, VERBATIM_INPUT } from "../sections/controls";
import { Select } from "../../ui/Select";
import { showConfirm, showMessage } from "../../ui/app-dialog";
import { links, plugins as pluginsIpc } from "../../platform/ipc";
import { isDesktopApp } from "../../platform/capabilities";
import { errorText } from "../../utils/error-text";
import type { Strings } from "../../i18n/strings";
import {
  installPlugin,
  loadDevPlugin,
  loadPluginSettings,
  pluginName,
  pluginSetting,
  pluginText,
  pluginsSnapshot,
  reloadPlugin,
  revokePermission,
  setAllPlugins,
  setPluginEnabled,
  setPluginSetting,
  subscribePlugins,
  uninstallPlugin,
  type PluginRecord,
} from "../../plugins/manager";
import { permissionLabel } from "../../plugins/permissions";
import { PluginSettingsWebview } from "../../plugins/PluginWebview";
import type { SettingContribution } from "../../plugins/manifest";

/**
 * Settings › Plugins (docs/design/plugins.md §6): the switch for all of
 * them, installing one, and every plugin with its switch - opened, what it
 * adds, the permissions it was granted (each revocable), its settings and
 * its own settings page.
 */
export function PluginsPage({ t }: SettingsPageProps) {
  const snapshot = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  const [open, setOpen] = useState<string | null>(null);
  const official = snapshot.records.filter((r) => r.origin === "official");
  const others = snapshot.records.filter((r) => r.origin !== "official");

  const attempt = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (err) {
      void showMessage(errorText(err), {
        title: t.pluginsTitle,
        tone: "error",
      });
    }
  };
  const install = (folder: boolean) =>
    attempt(async () => {
      const path = await pluginsIpc.pickPackage(folder, t.pluginPackageFilter);
      if (!path) return;
      setOpen(await (folder ? loadDevPlugin(path) : installPlugin(path)));
    });

  const row = (record: PluginRecord) => (
    <PluginRow
      key={record.id}
      record={record}
      t={t}
      allOn={snapshot.allOn}
      open={open === record.id}
      onToggleOpen={() => setOpen(open === record.id ? null : record.id)}
      attempt={attempt}
    />
  );

  return (
    <>
      <SettingsGroup title={t.pluginsTitle}>
        <ToggleRow
          label={t.pluginsAllLabel}
          help={t.pluginsAllHelp}
          checked={snapshot.allOn}
          onChange={(on) => void attempt(() => setAllPlugins(on))}
        />
        {isDesktopApp && (
          <SettingRow label={t.pluginsInstallLabel} help={t.pluginsInstallHelp}>
            <div className="plugin-install-buttons">
              <button type="button" onClick={() => void install(false)}>
                {t.pluginsInstallFile}
              </button>
              <button type="button" onClick={() => void install(true)}>
                {t.pluginsLoadFolder}
              </button>
            </div>
          </SettingRow>
        )}
      </SettingsGroup>
      <SettingsGroup title={t.pluginsOfficialGroup}>
        {official.length ? (
          official.map(row)
        ) : (
          <p className="plugin-empty">{t.pluginsNone}</p>
        )}
      </SettingsGroup>
      <SettingsGroup title={t.pluginsInstalledGroup}>
        {others.length ? (
          others.map(row)
        ) : (
          <p className="plugin-empty">{t.pluginsNone}</p>
        )}
      </SettingsGroup>
    </>
  );
}

function statusText(
  record: PluginRecord,
  allOn: boolean,
  t: Strings,
): string | null {
  switch (record.status) {
    case "broken":
      return t.pluginStatusBroken.replace("{reason}", record.problem ?? "");
    case "incompatible":
      return t.pluginStatusIncompatible.replace(
        "{range}",
        record.problem ?? "",
      );
    case "failed":
      return t.pluginStatusFailed.replace("{reason}", record.problem ?? "");
    case "on":
      return allOn ? null : t.pluginStatusAllOff;
    default:
      return null;
  }
}

function PluginRow({
  record,
  t,
  allOn,
  open,
  onToggleOpen,
  attempt,
}: {
  record: PluginRecord;
  t: Strings;
  allOn: boolean;
  open: boolean;
  onToggleOpen: () => void;
  attempt: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const name = pluginName(record);
  const manifest = record.manifest;
  const status = statusText(record, allOn, t);
  const canSwitch =
    !!manifest &&
    record.status !== "broken" &&
    record.status !== "incompatible";
  return (
    <div className="plugin-row" data-plugin={record.id}>
      <div className="settings-row plugin-row-head">
        {record.icon ? (
          <img className="plugin-icon" src={record.icon} alt="" />
        ) : (
          <span className="plugin-icon plugin-icon-blank" aria-hidden="true" />
        )}
        <div className="settings-row-text">
          <div className="settings-row-label">
            {name}
            {manifest && (
              <span className="plugin-version" data-search-ignore>
                {manifest.version}
                {record.origin === "dev" ? ` · ${t.pluginDevTag}` : ""}
              </span>
            )}
          </div>
          {manifest?.description && (
            <div className="settings-row-hint">
              {pluginText(record, manifest.description)}
            </div>
          )}
          {status && <div className="settings-error">{status}</div>}
        </div>
        <div className="settings-row-control plugin-row-controls">
          {manifest && (
            <button
              type="button"
              className="plugin-details-button"
              aria-expanded={open}
              onClick={onToggleOpen}
            >
              {open ? t.pluginHideDetails : t.pluginShowDetails}
            </button>
          )}
          <input
            type="checkbox"
            aria-label={t.pluginEnableLabel.replace("{name}", name)}
            disabled={!canSwitch}
            checked={record.status === "on"}
            onChange={(e) =>
              void attempt(() => setPluginEnabled(record.id, e.target.checked))
            }
          />
        </div>
      </div>
      {open && manifest && (
        <PluginDetails record={record} t={t} attempt={attempt} />
      )}
    </div>
  );
}

function PluginDetails({
  record,
  t,
  attempt,
}: {
  record: PluginRecord;
  t: Strings;
  attempt: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const manifest = record.manifest!;
  const on = record.status === "on";
  useEffect(() => {
    if (on) void loadPluginSettings(record.id);
  }, [on, record.id]);
  const { commands, customEditors, sidebarTabs, settings, settingsPage } =
    manifest.contributes;
  const adds = [
    ...commands.map((c) => pluginText(record, c.title)),
    ...sidebarTabs.map((s) =>
      t.pluginAddsSidebarTab.replace("{name}", pluginText(record, s.title)),
    ),
    ...customEditors.map((e) =>
      t.pluginAddsFileType.replace("{types}", e.filenamePatterns.join(", ")),
    ),
  ];
  const name = pluginName(record);
  return (
    <div className="plugin-details">
      {adds.length > 0 && (
        <SettingRow label={t.pluginAddsLabel} hint={adds.join(" · ")} />
      )}
      <SettingRow
        label={t.pluginPermissionsLabel}
        hint={manifest.permissions.length ? undefined : t.pluginNoPermissions}
      />
      {manifest.permissions.map((permission) => {
        const granted = record.granted.includes(permission);
        return (
          <SettingRow
            key={permission}
            label={permissionLabel(permission, t)}
            hint={granted ? t.pluginGranted : t.pluginNotGranted}
          >
            {granted && (
              <button
                type="button"
                onClick={() =>
                  void attempt(() => revokePermission(record.id, permission))
                }
              >
                {t.pluginRevoke}
              </button>
            )}
          </SettingRow>
        );
      })}
      {on &&
        settings.map((setting) => (
          <PluginSettingRow
            key={setting.key}
            record={record}
            setting={setting}
          />
        ))}
      {on && settingsPage && (
        <div className="plugin-settings-page">
          <h3 className="plugin-settings-page-title">
            {pluginText(record, settingsPage.title)}
          </h3>
          <PluginSettingsWebview plugin={record.id} />
        </div>
      )}
      <div className="plugin-detail-actions">
        {manifest.repository && (
          <button
            type="button"
            onClick={() => void links.openWebLink(manifest.repository!)}
          >
            {t.pluginRepository}
          </button>
        )}
        {record.origin === "dev" && (
          <button
            type="button"
            onClick={() => void attempt(() => reloadPlugin(record.id))}
          >
            {t.pluginReload}
          </button>
        )}
        {record.origin !== "official" && (
          <button
            type="button"
            className="danger"
            onClick={() =>
              void attempt(async () => {
                const ok = await showConfirm(
                  t.pluginUninstallAsk.replace("{name}", name),
                  {
                    title: t.pluginsTitle,
                    okLabel: t.pluginUninstall,
                    cancelLabel: t.pluginCancel,
                    danger: true,
                  },
                );
                if (ok) await uninstallPlugin(record.id);
              })
            }
          >
            {record.origin === "dev" ? t.pluginUnload : t.pluginUninstall}
          </button>
        )}
      </div>
    </div>
  );
}

/** One of a plugin's settings, drawn from its schema like Textus's own. */
function PluginSettingRow({
  record,
  setting,
}: {
  record: PluginRecord;
  setting: SettingContribution;
}) {
  const value = pluginSetting(record.id, setting.key);
  const label = pluginText(record, setting.title);
  const help = setting.description
    ? pluginText(record, setting.description)
    : undefined;
  const save = (next: unknown) =>
    void setPluginSetting(record.id, setting.key, next);
  if (setting.type === "boolean")
    return (
      <ToggleRow
        label={label}
        help={help}
        checked={value === true}
        onChange={save}
      />
    );
  return (
    <SettingRow label={label} help={help}>
      {setting.type === "enum" ? (
        <Select
          className="settings-select"
          aria-label={label}
          value={String(value)}
          onChange={(e) => save(e.target.value)}
        >
          {setting.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {pluginText(record, option.label)}
            </option>
          ))}
        </Select>
      ) : (
        <input
          className="plugin-setting-input"
          aria-label={label}
          type={setting.type === "number" ? "number" : "text"}
          defaultValue={String(value ?? "")}
          {...VERBATIM_INPUT}
          onBlur={(e) =>
            save(
              setting.type === "number"
                ? Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )}
    </SettingRow>
  );
}
