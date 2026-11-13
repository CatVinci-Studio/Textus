import { Byline } from "./CatalogRow";
import { fill } from "../../i18n/fill";
import { SettingsGroup } from "./SettingsGroup";
import { SettingRow } from "../sections/controls";
import { PluginSettingRows } from "./PluginSettings";
import { PluginErrors } from "./PluginErrors";
import { PluginData } from "./PluginData";
import { showConfirm } from "../../engine/controls/app-dialog";
import { links } from "../../platform/ipc";
import { useSettings } from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";
import {
  pluginName,
  pluginText,
  type PluginRecord,
} from "../../plugins/store/plugin-records";
import {
  reloadPlugin,
  revokePermission,
  uninstallPlugin,
} from "../../plugins/plugin-switches";
import { runsHere } from "../../plugins/plugin-platform";
import {
  requirementLabel,
  requirementMet,
  turnOnRequirement,
} from "../../plugins/store/requirements";
import { permissionLabel } from "../../plugins/store/permissions";
import { canSwitch } from "../../plugins/store/lifecycle";
import { PluginReadme } from "./PluginArt";
import { PluginSettingsWebview } from "../../plugins/views/plugin-views";
import { exportPluginForPublishing } from "../../plugins/store/plugin-export";

export type Attempt = (work: () => Promise<unknown>) => Promise<void>;

export function statusText(
  record: PluginRecord,
  allOn: boolean,
  t: Strings,
): string | null {
  switch (record.status) {
    case "broken":
      return fill(t.pluginStatusBroken, { reason: record.problem ?? "" });
    case "incompatible":
      if (record.manifest && !runsHere(record.manifest))
        return t.pluginStatusDesktopOnly;
      return fill(t.pluginStatusIncompatible, { range: record.problem ?? "" });
    case "failed":
      return fill(t.pluginStatusFailed, { reason: record.problem ?? "" });
    case "on":
      return allOn ? null : t.pluginStatusAllOff;
    default:
      return null;
  }
}

/** One plugin's own page: about it, what it needs, its settings, what it
 *  adds, its permissions, and removing it. */
export function PluginPage({
  record,
  t,
  allOn,
  update,
  installing,
  onBack,
  onEnable,
  onUpdate,
  onEditWithAi,
  attempt,
}: {
  record: PluginRecord;
  t: Strings;
  allOn: boolean;
  update: string | null;
  installing: boolean;
  /** Back to a list it was opened from; none in a tab of its own. */
  onBack?: () => void;
  onEnable: (on: boolean) => void;
  onUpdate: () => void;
  /** The AI panel in Create mode, asked to change it. */
  onEditWithAi: () => void;
  attempt: Attempt;
}) {
  const { settings, setSettings } = useSettings();
  const manifest = record.manifest;
  const name = pluginName(record);
  const on = record.status === "on";
  // Its settings need its code running: its switch and "all plugins" on.
  const runs = on && allOn;
  const status = statusText(record, allOn, t);
  const switchable = !!manifest && canSwitch(record.status);
  return (
    <div className="plugin-page" data-plugin-page={record.id}>
      {onBack && (
        <button type="button" className="plugin-back" onClick={onBack}>
          ‹ {t.pluginBackToList}
        </button>
      )}
      {/* Its name is on its tab: the page starts with what to do. Only
          the switch turns it on or off. */}
      <SettingsGroup>
        <SettingRow label={t.pluginOnLabel}>
          <input
            type="checkbox"
            className="tx-switch"
            role="switch"
            aria-label={fill(t.pluginEnableLabel, { name })}
            disabled={!switchable}
            checked={on}
            onChange={(e) => onEnable(e.target.checked)}
          />
        </SettingRow>
        {status && <div className="settings-error">{status}</div>}
        {manifest && (
          <SettingRow
            label={fill(t.pluginVersionLabel, { version: manifest.version })}
            hint={
              <Byline
                t={t}
                official={record.official}
                author={manifest.author || manifest.publisher}
                // The version is the row's own label: here only its source.
                version={record.origin === "dev" ? manifest.version : undefined}
                dev={record.origin === "dev"}
              >
                {manifest.license && <span>{manifest.license}</span>}
              </Byline>
            }
          >
            {update && (
              <button
                type="button"
                className="text-button settings-inline-button"
                disabled={installing}
                onClick={onUpdate}
              >
                {installing
                  ? t.pluginInstalling
                  : fill(t.pluginUpdate, { version: update })}
              </button>
            )}
            {manifest.repository && (
              <button
                type="button"
                className="text-button settings-inline-button"
                onClick={() => void links.openWebLink(manifest.repository!)}
              >
                {t.pluginRepository}
              </button>
            )}
            <button
              type="button"
              className="text-button settings-inline-button"
              onClick={onEditWithAi}
            >
              {t.pluginEditWithAi}
            </button>
          </SettingRow>
        )}
      </SettingsGroup>
      {manifest && manifest.requires.length > 0 && (
        <SettingsGroup title={t.pluginRequiresGroup}>
          {manifest.requires.map((need) => {
            const met = requirementMet(need, settings);
            return (
              <SettingRow
                key={need.setting}
                label={requirementLabel(need, t)}
                hint={need.reason ? pluginText(record, need.reason) : undefined}
              >
                {met ? (
                  <span className="plugin-requirement-met">
                    {t.pluginRequiresOn}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-button settings-inline-button"
                    onClick={() => setSettings(turnOnRequirement(need))}
                  >
                    {t.pluginTurnOn}
                  </button>
                )}
              </SettingRow>
            );
          })}
        </SettingsGroup>
      )}
      {manifest &&
        (!runs ||
          manifest.contributes.settings.length > 0 ||
          !manifest.contributes.settingsPage) && (
          <SettingsGroup title={t.pluginSettingsGroup}>
            {!runs ? (
              <p className="tx-list-note">
                {on
                  ? t.pluginStatusAllOff
                  : fill(t.pluginSettingsOff, { name })}
              </p>
            ) : manifest.contributes.settings.length === 0 ? (
              <p className="tx-list-note">
                {fill(t.pluginNoSettings, { name })}
              </p>
            ) : (
              <PluginSettingRows record={record} t={t} />
            )}
          </SettingsGroup>
        )}
      {/* The plugin's own settings page draws its own groups: on the page,
          not inside one. */}
      {runs && manifest?.contributes.settingsPage && (
        <div className="plugin-settings-page">
          <PluginSettingsWebview plugin={record.id} />
        </div>
      )}
      <PluginReadme
        id={record.id}
        installed
        label={fill(t.pluginReadmeLabel, { name })}
      />
      {manifest && (
        <PluginPermissions record={record} t={t} attempt={attempt} />
      )}
      <PluginErrors id={record.id} t={t} />
      <div className="plugin-detail-actions">
        {record.origin === "dev" && (
          <button
            type="button"
            className="text-button settings-inline-button"
            onClick={() => void attempt(() => reloadPlugin(record.id))}
          >
            {t.pluginReload}
          </button>
        )}
        {(record.origin === "dev" || record.id.startsWith("local.")) && (
          <button
            type="button"
            className="text-button settings-inline-button"
            onClick={() => void exportPluginForPublishing(record.id)}
          >
            {t.pluginExport}
          </button>
        )}
        <button
          type="button"
          className="text-button settings-inline-button danger"
          onClick={() =>
            void attempt(async () => {
              const ok = await showConfirm(
                fill(t.pluginUninstallAsk, { name }),
                {
                  title: t.pluginsTitle,
                  okLabel: t.pluginUninstall,
                  cancelLabel: t.cancel,
                  danger: true,
                },
              );
              if (!ok) return;
              await uninstallPlugin(record.id);
              onBack?.();
            })
          }
        >
          {record.origin === "dev" ? t.pluginUnload : t.pluginUninstall}
        </button>
      </div>
    </div>
  );
}

/** The permissions it has (each revocable), and the data it keeps. */
function PluginPermissions({
  record,
  t,
  attempt,
}: {
  record: PluginRecord;
  t: Strings;
  attempt: Attempt;
}) {
  const manifest = record.manifest!;
  return (
    <SettingsGroup title={t.pluginPermissionsLabel}>
      {manifest.permissions.length === 0 && (
        <p className="tx-list-note">{t.pluginNoPermissions}</p>
      )}
      {manifest.permissions.map((permission) => {
        const granted = record.granted.includes(permission);
        return (
          <div className="plugin-permission" key={permission}>
            <span>
              {permissionLabel(permission, t)}
              {" · "}
              {granted ? t.pluginGranted : t.pluginNotGranted}
            </span>
            {granted && (
              <button
                type="button"
                className="text-button settings-inline-button"
                onClick={() =>
                  void attempt(() => revokePermission(record.id, permission))
                }
              >
                {t.pluginRevoke}
              </button>
            )}
          </div>
        );
      })}
      <PluginData id={record.id} name={pluginName(record)} t={t} />
    </SettingsGroup>
  );
}
