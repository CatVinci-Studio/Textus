import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { askAi } from "../../ai/chat/ask-ai";
import type { SettingsPageProps } from "./types";
import { Byline, PluginPage, statusText } from "./PluginPage";
import { ExtensionsTabLayout } from "./ExtensionsTabLayout";
import { usePluginActions } from "./PluginAction";
import { ToggleRow } from "../sections/controls";
import { links, plugins as pluginsIpc } from "../../platform/ipc";
import { AvailablePlugins } from "./AvailablePlugins";
import { MarketPluginPage } from "./MarketPluginPage";
import { isDesktopApp } from "../../platform/capabilities";
import type { Strings } from "../../i18n/strings";
import {
  installPlugin,
  loadDevPlugin,
  pluginName,
  pluginText,
  pluginsSnapshot,
  setAllPlugins,
  subscribePlugins,
  type PluginRecord,
} from "../../plugins/manager";
import {
  catalogSnapshot,
  loadCatalog,
  subscribeCatalog,
  updateFor,
} from "../../plugins/store/catalog";
import { pluginMatches } from "../../plugins/store/plugin-records";
import { PluginIcon } from "./PluginArt";

/**
 * Settings › Extensions › Plugins. Nothing comes installed: one switch for
 * plugin features, then the installed plugins and, below, the catalog's
 * others; "⋯" installs from a file or loads a folder. Each card opens its
 * plugin's page.
 */
export function PluginsPage({ t, onClose }: SettingsPageProps) {
  const snapshot = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot);
  const { installing, install, enable, attempt, actionFor } =
    usePluginActions(t);
  const [open, setOpen] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    void loadCatalog();
  }, []);

  const installFile = (folder: boolean) =>
    attempt(async () => {
      const path = await pluginsIpc.pickPackage(folder, t.pluginPackageFilter);
      if (!path) return;
      if (folder) return setOpen(await loadDevPlugin(path));
      // Installed, its page, with its README.
      setOpen(await installPlugin(path));
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
      action={actionFor(record.id)}
      onOpen={() => setOpen(record.id)}
    />
  );
  const item =
    openItem && catalog.status === "ready"
      ? catalog.items.find((i) => i.id === openItem)
      : undefined;
  const installed = new Set(snapshot.records.map((r) => r.id));
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
        onEditWithAi={() => {
          onClose();
          askAi(editRequest(openRecord, t), "create");
        }}
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
        <ToggleRow
          label={t.pluginsAllLabel}
          help={t.pluginsAllHelp}
          checked={snapshot.allOn}
          onChange={(on) => void attempt(() => setAllPlugins(on))}
        />
      }
      off={!snapshot.allOn}
      query={query}
      onQuery={setQuery}
      installedTitle={t.pluginsInstalledGroup}
      installedCount={snapshot.records.length}
      installed={
        snapshot.records.length ? (
          <>
            {!shown.length && (
              <p className="plugin-empty">
                {t.pluginsSearchNone.replace("{query}", query.trim())}
              </p>
            )}
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
  action,
  onOpen,
}: {
  record: PluginRecord;
  t: Strings;
  allOn: boolean;
  action: ReactNode;
  onOpen: () => void;
}) {
  const name = pluginName(record);
  const manifest = record.manifest;
  // All turned off: every card quieter, the switch above says why.
  const status = statusText(record, true, t);
  return (
    <div
      className={`settings-row plugin-card${record.status === "on" || !allOn ? "" : " is-off"}`}
      data-plugin={record.id}
    >
      <button
        type="button"
        className="plugin-card-open plugin-card-with-icon"
        aria-label={t.pluginOpenDetails.replace("{name}", name)}
        onClick={onOpen}
      >
        <PluginIcon id={record.id} manifest={manifest} origin={record.origin} />
        <span className="plugin-card-text">
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
          {status && <span className="settings-error">{status}</span>}
        </span>
      </button>
      <div className="settings-row-control">{action}</div>
    </div>
  );
}

/** What "Edit with AI" puts in the AI panel's box: the plugin, and the
 *  error it last stopped with, for the user to say what to change. */
function editRequest(record: PluginRecord, t: Strings): string {
  const ask = t.pluginEditWithAiAsk
    .replace("{name}", pluginName(record))
    .replace("{id}", record.id);
  return record.problem
    ? `${ask}${t.pluginEditWithAiError.replace("{error}", record.problem)}`
    : ask;
}
