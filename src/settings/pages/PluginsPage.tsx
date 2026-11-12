import { fill } from "../../i18n/fill";
import { takeStartPlugin } from "./extensions-tab";
import { useMutedCards } from "../../plugins/store/usePluginCard";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { requestCreate } from "../../ai/chat/create-request";
import type { SettingsPageProps } from "./types";
import { PluginPage, statusText } from "./PluginPage";
import { Byline, CatalogRow } from "./CatalogRow";
import { ExtensionsTabLayout } from "./ExtensionsTabLayout";
import { usePluginActions } from "./PluginAction";
import { SettingRow, ToggleRow } from "../sections/controls";
import { links, plugins as pluginsIpc } from "../../platform/ipc";
import { AvailablePlugins } from "./AvailablePlugins";
import { MarketPluginPage } from "./MarketPluginPage";
import { isDesktopApp } from "../../platform/capabilities";
import type { Strings } from "../../i18n/strings";
import {
  pluginName,
  pluginText,
  pluginsSnapshot,
  subscribePlugins,
  type PluginRecord,
} from "../../plugins/store/plugin-records";
import {
  installPlugin,
  loadDevPlugin,
  setAllPlugins,
} from "../../plugins/plugin-switches";
import {
  catalogSnapshot,
  loadCatalog,
  subscribeCatalog,
  updateFor,
} from "../../plugins/store/catalog";
import { pluginMatches } from "../../plugins/store/plugin-records";
import { PluginIcon } from "./PluginArt";
import { useSettings } from "../../prefs/SettingsContext";
import { madeByAi } from "../../ai/chat/creations";

/**
 * Settings › Extensions › Plugins. Nothing comes installed: one switch for
 * plugin features, then the installed plugins and, below, the catalog's
 * others; "⋯" installs from a file or loads a folder. Each card opens its
 * plugin's page.
 */
export function PluginsPage({ t }: SettingsPageProps) {
  const snapshot = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  const { settings } = useSettings();
  const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot);
  const { installing, install, updateAll, enable, attempt, actionFor } =
    usePluginActions(t);
  const [open, setOpen] = useState<string | null>(takeStartPlugin);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    void loadCatalog();
  }, []);

  const installFile = (folder: boolean) =>
    attempt(async () => {
      const opened = await installPluginFiles(t, folder);
      if (opened) setOpen(opened);
    });

  // A catalog plugin installed from its page goes on as the installed
  // plugin's page.
  const openId = open ?? openItem;
  const openRecord = openId
    ? snapshot.records.find((r) => r.id === openId)
    : undefined;
  // Plugins made in Create mode (publisher "local") go last, under their own
  // heading.
  const isMine = (r: (typeof snapshot.records)[number]) =>
    r.manifest?.publisher === "local";
  const shown = snapshot.records.filter((r) => pluginMatches(r, query));
  const mine = shown.filter(isMine);
  const others = shown.filter((r) => !isMine(r));
  const card = (record: (typeof snapshot.records)[number]) => (
    <PluginCard
      key={record.id}
      record={record}
      t={t}
      allOn={snapshot.allOn}
      madeHere={madeByAi(settings.creations, "plugin", record.id)}
      action={actionFor(record.id)}
      onOpen={() => setOpen(record.id)}
    />
  );
  const item =
    openItem && catalog.status === "ready"
      ? catalog.items.find((i) => i.id === openItem)
      : undefined;
  const installed = new Set(snapshot.records.map((r) => r.id));
  // Two or more with updates: one button takes them all (one shows its own).
  const updates =
    catalog.status === "ready"
      ? catalog.items.filter(
          (i) => installed.has(i.id) && updateFor(i.id, catalog),
        )
      : [];
  // Installed from its page: the installed plugin's page instead.
  if (item && !installed.has(item.id))
    return (
      <MarketPluginPage
        item={item}
        t={t}
        installed={false}
        action={actionFor(item.id)}
        onBack={() => setOpenItem(null)}
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
        onBack={() => {
          setOpen(null);
          setOpenItem(null);
        }}
        onEditWithAi={() => requestCreate(editRequest(openRecord, t))}
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
      primary={{
        label: t.createMakePlugin,
        onSelect: () => requestCreate("", "plugin"),
      }}
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
              {
                label: t.pluginsOpenScripts,
                onSelect: () => void attempt(() => pluginsIpc.openScriptsDir()),
              },
            ]
          : []
      }
      top={
        <>
          <ToggleRow
            label={t.pluginsAllLabel}
            help={t.pluginsAllHelp}
            checked={snapshot.allOn}
            onChange={(on) => void attempt(() => setAllPlugins(on))}
          />
          <MutedSuggestions t={t} />
        </>
      }
      off={!snapshot.allOn}
      query={query}
      onQuery={setQuery}
      installedTitle={t.pluginsInstalledGroup}
      installedCount={snapshot.records.length}
      installedAction={
        updates.length > 1 && (
          <button
            type="button"
            className="text-button settings-inline-button"
            disabled={installing !== null}
            onClick={() => void updateAll(updates)}
          >
            {fill(t.pluginsUpdateAll, { count: String(updates.length) })}
          </button>
        )
      }
      installed={
        snapshot.records.length ? (
          <>
            {!shown.length && (
              <p className="tx-list-note">
                {fill(t.pluginsSearchNone, { query: query.trim() })}
              </p>
            )}
            {others.map(card)}
            {mine.length > 0 && (
              <>
                <h4 className="tx-list-heading plugin-subgroup-title">
                  {t.pluginsMine}
                </h4>
                {mine.map(card)}
              </>
            )}
          </>
        ) : (
          <p className="tx-list-note">{t.pluginsInstalledNone}</p>
        )
      }
      available={
        <AvailablePlugins
          t={t}
          catalog={catalog}
          query={query}
          installed={installed}
          actionFor={actionFor}
          onOpen={(i) => setOpenItem(i.id)}
        />
      }
      footer={<ListYours t={t} />}
    />
  );
}

/** The suggestion cards put away with × or Later, and bringing them back;
 *  nothing while there are none. */
function MutedSuggestions({ t }: { t: Strings }) {
  const { count, restore } = useMutedCards();
  if (!count) return null;
  return (
    <SettingRow label={fill(t.pluginCardsMuted, { n: String(count) })}>
      <button type="button" onClick={restore}>
        {t.pluginCardsRestore}
      </button>
    </SettingRow>
  );
}

/** Below the catalog: how to list a plugin of one's own. */
function ListYours({ t }: { t: Strings }) {
  return (
    <p className="plugin-group-help market-listing">
      {t.marketListYours}{" "}
      <button
        type="button"
        className="text-button settings-inline-button"
        onClick={() => void links.openAboutLink("listing")}
      >
        {t.marketListingRules}
      </button>
    </p>
  );
}

/** An installed plugin: opens its page; its button turns it off or on,
 *  updates or uninstalls it (PluginAction). */
function PluginCard({
  record,
  t,
  allOn,
  madeHere,
  action,
  onOpen,
}: {
  record: PluginRecord;
  t: Strings;
  allOn: boolean;
  madeHere: boolean;
  action: ReactNode;
  onOpen: () => void;
}) {
  const name = pluginName(record);
  const manifest = record.manifest;
  // All turned off: every card quieter, the switch above says why.
  const status = statusText(record, true, t);
  return (
    <CatalogRow
      data-plugin={record.id}
      off={record.status !== "on" && allOn}
      name={name}
      description={
        manifest?.description && pluginText(record, manifest.description)
      }
      icon={
        <PluginIcon id={record.id} manifest={manifest} origin={record.origin} />
      }
      byline={
        manifest && (
          <Byline
            t={t}
            official={record.official}
            madeHere={madeHere}
            author={manifest.author || manifest.publisher}
            version={manifest.version}
            dev={record.origin === "dev"}
          />
        )
      }
      status={status}
      openLabel={fill(t.pluginOpenDetails, { name })}
      onOpen={onOpen}
      action={action}
    />
  );
}

/** What "Edit with AI" puts in the AI panel's box: the plugin, and the
 *  error it last stopped with, for the user to say what to change. */
export function editRequest(record: PluginRecord, t: Strings): string {
  const ask = fill(t.pluginEditWithAiAsk, {
    name: pluginName(record),
    id: record.id,
  });
  return record.problem
    ? `${ask}${fill(t.pluginEditWithAiError, { error: record.problem })}`
    : ask;
}

/** Installs plugins picked from disk - a folder loaded as it is, or one or
 *  more packages; the id of the one to open after (one alone), else null.
 *  One that fails doesn't stop the others: each failure is told after. */
export async function installPluginFiles(
  t: Strings,
  folder: boolean,
): Promise<string | null> {
  const paths =
    (await pluginsIpc.pickPackage(folder, t.pluginPackageFilter)) ?? [];
  if (!paths.length) return null;
  if (folder) return loadDevPlugin(paths[0]);
  if (paths.length === 1) return installPlugin(paths[0]);
  const failed: string[] = [];
  for (const path of paths)
    await installPlugin(path).catch((e: unknown) =>
      failed.push(`${path.split(/[\\/]/).pop()}: ${String(e)}`),
    );
  if (failed.length) throw new Error(failed.join("\n"));
  return null;
}
