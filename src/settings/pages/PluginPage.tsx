import { useEffect, useState } from "react";
import { SettingsGroup } from "./SettingsGroup";
import { SettingRow } from "../sections/controls";
import { PluginSettingRows } from "./PluginSettings";
import { PluginErrors } from "./PluginErrors";
import { PluginData } from "./PluginData";
import { showConfirm } from "../../ui/app-dialog";
import { links } from "../../platform/ipc";
import { useSettings } from "../SettingsContext";
import type { Strings } from "../../i18n/strings";
import {
  pluginName,
  pluginText,
  reloadPlugin,
  revokePermission,
  uninstallPlugin,
  type PluginRecord,
} from "../../plugins/manager";
import {
  requirementLabel,
  requirementMet,
  turnOnRequirement,
} from "../../plugins/requirements";
import { permissionLabel } from "../../plugins/permissions";
import { canSwitch } from "../../plugins/lifecycle";
import { usageGuide } from "../../plugins/usage-guide";
import { PluginSettingsWebview } from "../../plugins/plugin-views";
import type { PluginManifest } from "../../plugins/manifest";

export type Attempt = (work: () => Promise<unknown>) => Promise<void>;

export function statusText(
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

/** Who made it, and whether it is CatVinci's own. */
export function Byline({
  manifest,
  official,
  dev,
  t,
}: {
  manifest: PluginManifest;
  official: boolean;
  dev?: boolean;
  t: Strings;
}) {
  return (
    <div className="plugin-byline">
      {official && <span className="plugin-official">{t.pluginOfficial}</span>}
      <span>
        {t.pluginBy.replace("{author}", manifest.author || manifest.publisher)}
      </span>
      <span className="plugin-version" data-search-ignore>
        {manifest.version}
        {dev ? ` · ${t.pluginDevTag}` : ""}
      </span>
    </div>
  );
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
  onGuide,
  onEditWithAi,
  attempt,
}: {
  record: PluginRecord;
  t: Strings;
  allOn: boolean;
  update: string | null;
  installing: boolean;
  onBack: () => void;
  onEnable: (on: boolean) => void;
  onUpdate: () => void;
  /** Opens its usage guide (USAGE.md), when it has one. */
  onGuide: () => void;
  /** The AI panel in Create mode, asked to change it (ask-ai.ts). */
  onEditWithAi: () => void;
  attempt: Attempt;
}) {
  const { settings, setSettings } = useSettings();
  const manifest = record.manifest;
  const name = pluginName(record);
  const on = record.status === "on";
  const status = statusText(record, allOn, t);
  const switchable = !!manifest && canSwitch(record.status);
  const [hasGuide, setHasGuide] = useState(false);
  useEffect(() => {
    let live = true;
    void usageGuide(record.id).then((text) => live && setHasGuide(!!text));
    return () => {
      live = false;
    };
  }, [record.id]);
  return (
    <div className="plugin-page" data-plugin-page={record.id}>
      <button type="button" className="plugin-back" onClick={onBack}>
        ‹ {t.pluginBackToList}
      </button>
      <div className="settings-group-body plugin-page-head">
        <label className="settings-row plugin-page-title-row">
          <div className="settings-row-text">
            <h2 className="plugin-page-title">{name}</h2>
            {manifest?.description && (
              <div className="settings-row-hint">
                {pluginText(record, manifest.description)}
              </div>
            )}
            {manifest && (
              <Byline
                manifest={manifest}
                official={record.official}
                dev={record.origin === "dev"}
                t={t}
              />
            )}
            {status && <div className="settings-error">{status}</div>}
          </div>
          <input
            type="checkbox"
            aria-label={t.pluginEnableLabel.replace("{name}", name)}
            disabled={!switchable}
            checked={on}
            onChange={(e) => onEnable(e.target.checked)}
          />
        </label>
        <div className="settings-row plugin-guide-row">
          {hasGuide && (
            <button
              type="button"
              className="text-button settings-inline-button"
              onClick={onGuide}
            >
              {t.pluginUsageGuide}
            </button>
          )}
          {manifest && (
            <button
              type="button"
              className="text-button settings-inline-button"
              onClick={onEditWithAi}
            >
              {t.pluginEditWithAi}
            </button>
          )}
        </div>
      </div>
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
                    onClick={() => setSettings(turnOnRequirement(need))}
                  >
                    {t.pluginRequiresTurnOn}
                  </button>
                )}
              </SettingRow>
            );
          })}
        </SettingsGroup>
      )}
      {manifest && (
        <SettingsGroup title={t.pluginSettingsGroup}>
          {!on ? (
            <p className="plugin-empty">
              {t.pluginSettingsOff.replace("{name}", name)}
            </p>
          ) : manifest.contributes.settings.length === 0 &&
            !manifest.contributes.settingsPage ? (
            <p className="plugin-empty">
              {t.pluginNoSettings.replace("{name}", name)}
            </p>
          ) : (
            <>
              <PluginSettingRows record={record} t={t} />
              {manifest.contributes.settingsPage && (
                <div className="plugin-settings-page">
                  <PluginSettingsWebview plugin={record.id} />
                </div>
              )}
            </>
          )}
        </SettingsGroup>
      )}
      <PluginErrors id={record.id} t={t} />
      {manifest && <PluginAbout record={record} t={t} attempt={attempt} />}
      <div className="plugin-detail-actions">
        {update && (
          <button type="button" disabled={installing} onClick={onUpdate}>
            {installing
              ? t.pluginInstalling
              : t.pluginUpdate.replace("{version}", update)}
          </button>
        )}
        {manifest?.repository && (
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
              if (!ok) return;
              await uninstallPlugin(record.id);
              onBack();
            })
          }
        >
          {record.origin === "dev" ? t.pluginUnload : t.pluginUninstall}
        </button>
      </div>
    </div>
  );
}

/** What the plugin adds, and the permissions it has (each revocable). */
function PluginAbout({
  record,
  t,
  attempt,
}: {
  record: PluginRecord;
  t: Strings;
  attempt: Attempt;
}) {
  const manifest = record.manifest!;
  const { aiTools, commands, customEditors, sidebarTabs } =
    manifest.contributes;
  const adds = [
    ...commands.map((c) => pluginText(record, c.title)),
    ...sidebarTabs.map((s) =>
      t.pluginAddsSidebarTab.replace("{name}", pluginText(record, s.title)),
    ),
    ...customEditors.map((e) =>
      t.pluginAddsFileType.replace("{types}", e.filenamePatterns.join(", ")),
    ),
    ...aiTools.map((tool) => t.pluginAddsAiTool.replace("{name}", tool.name)),
  ];
  return (
    <SettingsGroup title={t.pluginAboutGroup}>
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
      <PluginData id={record.id} name={pluginName(record)} t={t} />
      <SettingRow
        label={t.pluginVersionLabel.replace("{version}", manifest.version)}
        hint={manifest.license}
      />
    </SettingsGroup>
  );
}
