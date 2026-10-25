import { useEffect, useState, useSyncExternalStore } from "react";
import type { SettingsPageProps } from "./types";
import { Byline, PluginPage, statusText } from "./PluginPage";
import { ExtensionsTabLayout } from "./ExtensionsTabLayout";
import { askForRequirements, usePluginInstall } from "./usePluginInstall";
import { ToggleRow } from "../sections/controls";
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
import { openUsageGuide } from "../../plugins/usage-guide";

/**
 * Settings › Extensions › Plugins (docs/design/plugins.md §6). Nothing comes
 * installed: Get more (`onGetMore`) offers the catalog's plugins, "⋯"
 * installs one from a file or loads a folder; the installed plugins are
 * cards - its name, what it does, who made it (Official when it is
 * CatVinci's), its switch - that open the plugin's own page; the switch
 * for them all is under Advanced.
 */
export function PluginsPage({
  t,
  onClose,
  onGetMore,
}: SettingsPageProps & { onGetMore: () => void }) {
  const snapshot = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot);
  const { installing, install, attempt, settings, setSettings } =
    usePluginInstall(t);
  const [open, setOpen] = useState<string | null>(null);
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
      if (folder) return setOpen(await loadDevPlugin(path));
      const id = await installPlugin(path);
      // Installed, it shows how it is used, as from Get more; without a
      // guide, its page.
      if (await openUsageGuide(id)) onClose();
      else setOpen(id);
    });

  const openRecord = open
    ? snapshot.records.find((r) => r.id === open)
    : undefined;
  // The plugins made in Create mode (publisher "local") under their own
  // heading, after the rest.
  const isMine = (r: (typeof snapshot.records)[number]) =>
    r.manifest?.publisher === "local";
  const mine = snapshot.records.filter(isMine);
  const others = snapshot.records.filter((r) => !isMine(r));
  const card = (record: (typeof snapshot.records)[number]) => (
    <PluginCard
      key={record.id}
      record={record}
      t={t}
      allOn={snapshot.allOn}
      update={updateFor(record.id, catalog)}
      onOpen={() => setOpen(record.id)}
      onEnable={(on) => void enable(record, on)}
    />
  );
  if (openRecord)
    return (
      <PluginPage
        record={openRecord}
        t={t}
        allOn={snapshot.allOn}
        update={updateFor(openRecord.id, catalog)}
        installing={installing === openRecord.id}
        onBack={() => setOpen(null)}
        onGuide={() =>
          void openUsageGuide(openRecord.id).then((opened) => {
            if (opened) onClose();
          })
        }
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

  return (
    <ExtensionsTabLayout
      t={t}
      intro={t.extensionsIntroPlugins}
      help={t.pluginsInstallHelp}
      onGetMore={onGetMore}
      actions={
        isDesktopApp
          ? [
              {
                label: t.pluginsInstallFile,
                onSelect: () => void installFile(false),
              },
              {
                label: t.pluginsLoadFolder,
                onSelect: () => void installFile(true),
              },
            ]
          : []
      }
      installedTitle={t.pluginsInstalledGroup}
      installed={
        snapshot.records.length ? (
          <>
            {others.map(card)}
            {mine.length > 0 && (
              <>
                <h4 className="plugin-subgroup-title">{t.pluginsMine}</h4>
                {mine.map(card)}
              </>
            )}
          </>
        ) : (
          <p className="plugin-empty">{t.pluginsNone}</p>
        )
      }
      advanced={
        <ToggleRow
          label={t.pluginsAllLabel}
          help={t.pluginsAllHelp}
          checked={snapshot.allOn}
          onChange={(on) => void attempt(() => setAllPlugins(on))}
        />
      }
    />
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
