import { useEffect, useState, useSyncExternalStore } from "react";
import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { Byline, PluginPage, statusText } from "./PluginPage";
import { MarketPage } from "./MarketPage";
import { askForRequirements, usePluginInstall } from "./usePluginInstall";
import { LinkRow, SettingRow, ToggleRow } from "../sections/controls";
import { plugins as pluginsIpc } from "../../platform/ipc";
import { isDesktopApp } from "../../platform/capabilities";
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
  loadCatalog,
  subscribeCatalog,
  updateFor,
} from "../../plugins/catalog";
import { canSwitch } from "../../plugins/lifecycle";

/**
 * Settings › Extensions › Plugins (docs/design/plugins.md §6). Nothing comes
 * installed: first the switch for them all and installing from a file;
 * then the installed plugins, each a card - its name, what it does, who
 * made it (Official when it is CatVinci's), its switch - that opens the
 * plugin's own page; last, Get plugins, the catalog's plugins on a page of
 * their own (GetPluginsPage).
 */
export function PluginsPage({ t }: SettingsPageProps) {
  const snapshot = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot);
  const { installing, install, attempt, settings, setSettings } =
    usePluginInstall(t);
  const [open, setOpen] = useState<string | null>(null);
  const [getting, setGetting] = useState(false);
  useEffect(() => {
    void loadCatalog();
  }, []);

  /** Turns a plugin on, then offers to turn on what it needs. */
  const enable = (record: PluginRecord, on: boolean) =>
    attempt(async () => {
      await setPluginEnabled(record.id, on);
      if (on) await askForRequirements(record.id, t, settings, setSettings);
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

  if (getting)
    return <MarketPage t={t} kind="plugins" onBack={() => setGetting(false)} />;

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
      <section className="settings-group">
        <div className="settings-group-body">
          <LinkRow
            label={t.marketGetMore}
            onOpen={() => setGetting(true)}
            className="plugin-get-entry"
          />
        </div>
      </section>
    </>
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
