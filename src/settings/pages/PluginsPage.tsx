import { useEffect, useState, useSyncExternalStore } from "react";
import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { Byline, PluginPage, statusText, type Attempt } from "./PluginPage";
import { SettingRow, ToggleRow } from "../sections/controls";
import { showConfirm, showMessage } from "../../ui/app-dialog";
import { plugins as pluginsIpc } from "../../platform/ipc";
import { isDesktopApp } from "../../platform/capabilities";
import { useSettings } from "../SettingsContext";
import { errorText } from "../../utils/error-text";
import type { Strings } from "../../i18n/strings";
import {
  installPlugin,
  loadDevPlugin,
  pluginName,
  pluginText,
  pluginsSnapshot,
  setAllPlugins,
  setPluginEnabled,
  subscribePlugins,
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
import { canSwitch } from "../../plugins/lifecycle";

/**
 * Settings › Extensions › Plugins (docs/design/plugins.md §6). Nothing comes installed:
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
  const switchable = !!manifest && canSwitch(record.status);
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
        disabled={!switchable}
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
