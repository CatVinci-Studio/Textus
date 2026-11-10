import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { SearchField } from "../../engine/controls/SearchField";
import { SettingsIcon } from "../../engine/controls/icons";
import { Tooltip } from "../../engine/controls/Tooltip";
import { emitToThisWindow } from "../../platform/menu-events";
import {
  pluginName,
  pluginText,
  pluginsSnapshot,
  subscribePlugins,
} from "../../plugins/manager";
import {
  catalogSnapshot,
  loadCatalog,
  offeredItems,
  searchCatalog,
  sortCatalog,
  subscribeCatalog,
  updateFor,
} from "../../plugins/store/catalog";
import { pluginMatches } from "../../plugins/store/plugin-records";
import type { PluginManifest } from "../../plugins/store/manifest";
import type { Strings } from "../../i18n/strings";
import { PluginIcon } from "./PluginArt";
import { usePluginActions } from "./PluginAction";
import "./plugins-panel.css";

/** Opens a plugin's page in Settings (its README, settings, data). */
const openPage = (id: string) =>
  emitToThisWindow("menu-plugin-command", `plugin-settings:${id}`);

/**
 * The sidebar's Plugins page: one box over what is installed and what the
 * market offers, a row each - icon, name, its line, who made it - and the
 * one thing to do beside it (install, update) or its settings. The full
 * page of each stays in Settings › Extensions.
 */
export function PluginsPanel({ t }: { t: Strings }) {
  const plugins = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot);
  const { actionFor } = usePluginActions(t);
  const [query, setQuery] = useState("");
  useEffect(() => {
    void loadCatalog();
  }, []);
  const installedIds = new Set(plugins.records.map((r) => r.id));
  const installed = plugins.records.filter((r) => pluginMatches(r, query));
  const offered =
    catalog.status === "ready"
      ? offeredItems(
          sortCatalog(searchCatalog(catalog.items, query), "popular"),
          installedIds,
        )
      : [];
  return (
    <div className="plugins-panel">
      <SearchField
        className="plugins-panel-search"
        value={query}
        placeholder={t.marketSearch}
        aria-label={t.marketSearch}
        onChange={(e) => setQuery(e.target.value)}
      />
      <section aria-label={t.pluginsInstalledGroup}>
        <h3 className="tx-list-heading">
          {t.pluginsInstalledGroup}
          <span className="plugins-panel-count">{installed.length}</span>
        </h3>
        {installed.map((record) => (
          <PluginRow
            key={record.id}
            id={record.id}
            name={pluginName(record)}
            line={
              record.manifest?.description
                ? pluginText(record, record.manifest.description)
                : ""
            }
            manifest={record.manifest}
            off={record.status !== "on"}
            onOpen={() => openPage(record.id)}
            gear
            t={t}
            // An update is the one thing to do from here.
            end={
              catalog.status === "ready" && updateFor(record.id, catalog)
                ? actionFor(record.id)
                : null
            }
            icon={
              <PluginIcon
                id={record.id}
                manifest={record.manifest}
                origin={record.origin}
              />
            }
          />
        ))}
      </section>
      <section aria-label={t.extensionsAvailable}>
        <h3 className="tx-list-heading">{t.extensionsAvailable}</h3>
        {catalog.status !== "ready" ? (
          <p className="tx-list-note">
            {catalog.status === "failed"
              ? t.pluginsCatalogFailed.replace("{reason}", catalog.error)
              : t.pluginsCatalogLoading}
          </p>
        ) : query.trim() && offered.length === 0 ? (
          <p className="tx-list-note">
            {t.pluginsSearchNone.replace("{query}", query.trim())}
          </p>
        ) : (
          offered.map((item) => (
            <PluginRow
              key={item.id}
              id={item.id}
              name={pluginName({ id: item.id, manifest: item.manifest })}
              line={pluginText(
                { manifest: item.manifest },
                item.manifest.description,
              )}
              manifest={item.manifest}
              onOpen={() => emitToThisWindow("menu-manage-plugins")}
              t={t}
              end={actionFor(item.id)}
              icon={
                <PluginIcon
                  id={item.id}
                  manifest={item.manifest}
                  url={item.icon}
                />
              }
            />
          ))
        )}
      </section>
    </div>
  );
}

function PluginRow({
  id,
  name,
  line,
  manifest,
  off = false,
  icon,
  end,
  onOpen,
  gear = false,
  t,
}: {
  id: string;
  name: string;
  line: string;
  manifest: PluginManifest | null;
  off?: boolean;
  icon: ReactNode;
  /** Its button: install, or update. */
  end: ReactNode;
  onOpen: () => void;
  /** Installed: a gear to its settings. */
  gear?: boolean;
  t: Strings;
}) {
  const by = manifest?.author || manifest?.publisher;
  return (
    <div
      className="plugins-panel-row"
      data-plugin={id}
      data-off={off || undefined}
    >
      <button
        type="button"
        className="plugins-panel-open"
        aria-label={t.pluginOpenDetails.replace("{name}", name)}
        onClick={onOpen}
      >
        {icon}
        <span className="plugins-panel-text">
          <span className="plugins-panel-name">{name}</span>
          {line && <span className="plugins-panel-line">{line}</span>}
          {by && <span className="plugins-panel-by">{by}</span>}
        </span>
      </button>
      <span className="plugins-panel-end">
        {end}
        {gear && (
          <Tooltip text={t.pluginOpenDetails.replace("{name}", name)}>
            <button
              type="button"
              className="tree-tool plugins-panel-gear"
              aria-label={t.pluginOpenDetails.replace("{name}", name)}
              onClick={onOpen}
            >
              <SettingsIcon />
            </button>
          </Tooltip>
        )}
      </span>
    </div>
  );
}
