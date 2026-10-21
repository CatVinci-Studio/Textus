import { useEffect, useState, useSyncExternalStore } from "react";
import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { SettingRow, ToggleRow, VERBATIM_INPUT } from "../sections/controls";
import { Select } from "../../ui/Select";
import { showConfirm, showMessage } from "../../ui/app-dialog";
import { links, plugins as pluginsIpc } from "../../platform/ipc";
import { isDesktopApp } from "../../platform/capabilities";
import { useSettings } from "../SettingsContext";
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
import {
  catalogSnapshot,
  installFromCatalog,
  loadCatalog,
  notInstalled,
  subscribeCatalog,
  updateFor,
  type CatalogItem,
} from "../../plugins/catalog";
import {
  requirementLabel,
  requirementMet,
  turnOnRequirement,
} from "../../plugins/requirements";
import { permissionLabel } from "../../plugins/permissions";
import { PluginSettingsWebview } from "../../plugins/PluginWebview";
import type {
  PluginManifest,
  SettingContribution,
} from "../../plugins/manifest";

type Attempt = (work: () => Promise<unknown>) => Promise<void>;

/**
 * Settings › Plugins (docs/design/plugins.md §6). Nothing comes installed:
 * the installed plugins, each a card - its name, what it does, who made it
 * (Official when it is CatVinci's), its switch - that opens the plugin's
 * own page; then the plugins the catalog offers, to install; then
 * installing from a file and the switch for them all.
 */
export function PluginsPage({ t }: SettingsPageProps) {
  const snapshot = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot);
  const { settings, setSettings } = useSettings();
  const [open, setOpen] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  useEffect(() => {
    void loadCatalog();
  }, []);

  const attempt: Attempt = async (work) => {
    try {
      await work();
    } catch (err) {
      void showMessage(errorText(err), {
        title: t.pluginsTitle,
        tone: "error",
      });
    }
  };

  /** Turns a plugin on, then offers to turn on what it needs. */
  const enable = (record: PluginRecord, on: boolean) =>
    attempt(async () => {
      await setPluginEnabled(record.id, on);
      if (on) await askForRequirements(record.id, t, settings, setSettings);
    });

  const install = (item: CatalogItem) =>
    attempt(async () => {
      setInstalling(item.id);
      try {
        await installFromCatalog(item.id);
        await askForRequirements(item.id, t, settings, setSettings);
      } finally {
        setInstalling(null);
      }
    });

  const installFile = (folder: boolean) =>
    attempt(async () => {
      const path = await pluginsIpc.pickPackage(folder, t.pluginPackageFilter);
      if (!path) return;
      setOpen(await (folder ? loadDevPlugin(path) : installPlugin(path)));
    });

  const openRecord = open
    ? snapshot.records.find((r) => r.id === open)
    : undefined;
  if (openRecord)
    return (
      <PluginPage
        record={openRecord}
        t={t}
        allOn={snapshot.allOn}
        update={updateFor(openRecord.id, catalog)}
        installing={installing === openRecord.id}
        onBack={() => setOpen(null)}
        onEnable={(on) => void enable(openRecord, on)}
        onUpdate={() => {
          const item =
            catalog.status === "ready"
              ? catalog.items.find((i) => i.id === openRecord.id)
              : undefined;
          if (item) void install(item);
        }}
        attempt={attempt}
      />
    );

  const offered = notInstalled(catalog);
  return (
    <>
      <SettingsGroup title={t.pluginsInstalledGroup}>
        {snapshot.records.length ? (
          snapshot.records.map((record) => (
            <PluginCard
              key={record.id}
              record={record}
              t={t}
              allOn={snapshot.allOn}
              update={updateFor(record.id, catalog)}
              onOpen={() => setOpen(record.id)}
              onEnable={(on) => void enable(record, on)}
            />
          ))
        ) : (
          <p className="plugin-empty">{t.pluginsNone}</p>
        )}
      </SettingsGroup>
      <SettingsGroup title={t.pluginsGetGroup}>
        <p className="plugin-group-help">{t.pluginsGetHelp}</p>
        {catalog.status === "failed" ? (
          <div className="settings-row plugin-catalog-problem">
            <div className="settings-row-text">
              <div className="settings-error">
                {t.pluginsCatalogFailed.replace("{reason}", catalog.error)}
              </div>
            </div>
            <div className="settings-row-control">
              <button type="button" onClick={() => void loadCatalog(true)}>
                {t.pluginsCatalogRetry}
              </button>
            </div>
          </div>
        ) : catalog.status !== "ready" ? (
          <p className="plugin-empty">{t.pluginsCatalogLoading}</p>
        ) : offered.length ? (
          offered.map((item) => (
            <CatalogCard
              key={item.id}
              item={item}
              t={t}
              installing={installing === item.id}
              onInstall={() => void install(item)}
            />
          ))
        ) : (
          <p className="plugin-empty">{t.pluginsCatalogAllInstalled}</p>
        )}
      </SettingsGroup>
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
              <button type="button" onClick={() => void installFile(false)}>
                {t.pluginsInstallFile}
              </button>
              <button type="button" onClick={() => void installFile(true)}>
                {t.pluginsLoadFolder}
              </button>
            </div>
          </SettingRow>
        )}
      </SettingsGroup>
    </>
  );
}

/** What a plugin needs that is off: asked to turn each on, once, in the
 *  plugin's words. */
async function askForRequirements(
  id: string,
  t: Strings,
  settings: ReturnType<typeof useSettings>["settings"],
  setSettings: ReturnType<typeof useSettings>["setSettings"],
) {
  const record = pluginsSnapshot().records.find((r) => r.id === id);
  if (!record?.manifest || record.status !== "on") return;
  for (const need of record.manifest.requires) {
    if (requirementMet(need, settings)) continue;
    const ok = await showConfirm(
      t.pluginRequiresAsk
        .replace("{name}", pluginName(record))
        .replace("{setting}", requirementLabel(need, t))
        .replace(
          "{reason}",
          need.reason ? pluginText(record, need.reason) : "",
        ),
      {
        title: pluginName(record),
        okLabel: t.pluginRequiresTurnOn,
        cancelLabel: t.pluginRequiresLater,
      },
    );
    if (ok) setSettings(turnOnRequirement(need));
  }
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

/** Who made it, and whether it is CatVinci's own. */
function Byline({
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

/** An installed plugin: opens its page; the switch turns it on or off. */
function PluginCard({
  record,
  t,
  allOn,
  update,
  onOpen,
  onEnable,
}: {
  record: PluginRecord;
  t: Strings;
  allOn: boolean;
  update: string | null;
  onOpen: () => void;
  onEnable: (on: boolean) => void;
}) {
  const name = pluginName(record);
  const manifest = record.manifest;
  const status = statusText(record, allOn, t);
  const canSwitch =
    !!manifest &&
    record.status !== "broken" &&
    record.status !== "incompatible";
  return (
    <div className="settings-row plugin-card" data-plugin={record.id}>
      <button
        type="button"
        className="plugin-card-open"
        aria-label={t.pluginOpenDetails.replace("{name}", name)}
        onClick={onOpen}
      >
        <span className="settings-row-label plugin-card-name">{name}</span>
        {manifest?.description && (
          <span className="settings-row-hint plugin-card-description">
            {pluginText(record, manifest.description)}
          </span>
        )}
        {manifest && (
          <Byline
            manifest={manifest}
            official={record.official}
            dev={record.origin === "dev"}
            t={t}
          />
        )}
        {update && (
          <span className="plugin-update-note">
            {t.pluginUpdate.replace("{version}", update)}
          </span>
        )}
        {status && <span className="settings-error">{status}</span>}
      </button>
      <input
        type="checkbox"
        aria-label={t.pluginEnableLabel.replace("{name}", name)}
        disabled={!canSwitch}
        checked={record.status === "on"}
        onChange={(e) => onEnable(e.target.checked)}
      />
    </div>
  );
}

/** A plugin the catalog offers, with Install. */
function CatalogCard({
  item,
  t,
  installing,
  onInstall,
}: {
  item: CatalogItem;
  t: Strings;
  installing: boolean;
  onInstall: () => void;
}) {
  const record = { manifest: item.manifest };
  return (
    <div className="settings-row plugin-card" data-catalog={item.id}>
      <div className="plugin-card-open">
        <span className="settings-row-label plugin-card-name">
          {pluginName({ id: item.id, manifest: item.manifest })}
        </span>
        <span className="settings-row-hint plugin-card-description">
          {pluginText(record, item.manifest.description)}
        </span>
        <Byline manifest={item.manifest} official={item.official} t={t} />
      </div>
      <div className="settings-row-control">
        <button
          type="button"
          className="plugin-install"
          disabled={installing}
          onClick={onInstall}
        >
          {installing ? t.pluginInstalling : t.pluginInstall}
        </button>
      </div>
    </div>
  );
}

/** One plugin's own page: about it, what it needs, its settings, what it
 *  adds, its permissions, and removing it. */
function PluginPage({
  record,
  t,
  allOn,
  update,
  installing,
  onBack,
  onEnable,
  onUpdate,
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
  attempt: Attempt;
}) {
  const { settings, setSettings } = useSettings();
  const manifest = record.manifest;
  const name = pluginName(record);
  const on = record.status === "on";
  useEffect(() => {
    if (on) void loadPluginSettings(record.id);
  }, [on, record.id]);
  const status = statusText(record, allOn, t);
  const canSwitch =
    !!manifest &&
    record.status !== "broken" &&
    record.status !== "incompatible";
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
            disabled={!canSwitch}
            checked={on}
            onChange={(e) => onEnable(e.target.checked)}
          />
        </label>
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
              {manifest.contributes.settings.map((setting) => (
                <PluginSettingRow
                  key={setting.key}
                  record={record}
                  setting={setting}
                />
              ))}
              {manifest.contributes.settingsPage && (
                <div className="plugin-settings-page">
                  <PluginSettingsWebview plugin={record.id} />
                </div>
              )}
            </>
          )}
        </SettingsGroup>
      )}
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
  const { commands, customEditors, sidebarTabs } = manifest.contributes;
  const adds = [
    ...commands.map((c) => pluginText(record, c.title)),
    ...sidebarTabs.map((s) =>
      t.pluginAddsSidebarTab.replace("{name}", pluginText(record, s.title)),
    ),
    ...customEditors.map((e) =>
      t.pluginAddsFileType.replace("{types}", e.filenamePatterns.join(", ")),
    ),
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
      <SettingRow
        label={t.pluginVersionLabel.replace("{version}", manifest.version)}
        hint={manifest.license}
      />
    </SettingsGroup>
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
          className="settings-text-input plugin-setting-input"
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
