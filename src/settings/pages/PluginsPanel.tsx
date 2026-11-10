import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { SearchField } from "../../engine/controls/SearchField";
import {
  ChevronIcon,
  PlusIcon,
  RefreshIcon,
} from "../../engine/controls/icons";
import { IconButton } from "../../engine/controls/IconButton";
import {
  ContextMenu,
  type ContextMenuEntry,
} from "../../engine/controls/ContextMenu";
import { Presence } from "../../engine/motion/usePresence";
import { requestCreate } from "../../ai/chat/create-request";
import { isDesktopApp } from "../../platform/capabilities";
import { plugins as pluginsIpc } from "../../platform/ipc";
import { setAllPlugins } from "../../plugins/manager";
import { installPluginFiles } from "./PluginsPage";
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

/** Opens a plugin's page (its README, settings, data) in the Plugins
 *  tab. */
const openPage = (id: string) =>
  emitToThisWindow("menu-plugin-command", `plugin-settings:${id}`);

/**
 * The sidebar's Plugins page: one box over what is installed and what the
 * market offers, a row each - icon, name, its line, who made it - and the
 * one thing to do beside it (install, update). A row opens its plugin's
 * page in a tab. Over the search: the switch for all plugins, "update
 * all" while there are updates, and "+" to add one (Create, a file, a
 * folder).
 */
export function PluginsPanel({
  t,
  picked,
  onPick = openPage,
}: {
  t: Strings;
  /** The plugin whose page shows beside the list. */
  picked?: string | null;
  /** A row chosen: its plugin's page. */
  onPick?: (id: string) => void;
}) {
  const plugins = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot);
  const { actionFor, install, installing, attempt, updateAll } =
    usePluginActions(t);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const fold = (group: string) =>
    setFolded((was) => {
      const next = new Set(was);
      if (!next.delete(group)) next.add(group);
      return next;
    });
  useEffect(() => {
    void loadCatalog();
  }, []);
  const installedIds = new Set(plugins.records.map((r) => r.id));
  const updates =
    catalog.status === "ready"
      ? catalog.items.filter(
          (i) => installedIds.has(i.id) && updateFor(i.id, catalog),
        )
      : [];
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
      <div className="plugins-panel-top">
        <label className="plugins-panel-switch">
          <input
            type="checkbox"
            role="switch"
            className="tx-switch"
            checked={plugins.allOn}
            onChange={(e) => {
              const on = e.target.checked;
              void attempt(() => setAllPlugins(on));
            }}
          />
          {t.pluginsAllLabel}
        </label>
        {updates.length > 0 && (
          <IconButton
            label={t.pluginsUpdateAll.replace(
              "{count}",
              String(updates.length),
            )}
            className="tree-tool plugins-panel-update-all"
            disabled={installing !== null}
            onClick={() => void updateAll(updates)}
          >
            <RefreshIcon />
            <span className="plugins-panel-badge">{updates.length}</span>
          </IconButton>
        )}
        <IconButton
          label={t.pluginsAdd}
          className="tree-tool plugins-panel-add"
          onClick={() => {
            const box = document
              .querySelector(".plugins-panel-add")
              ?.getBoundingClientRect();
            setMenu(box ? { x: box.left, y: box.bottom + 4 } : null);
          }}
        >
          <PlusIcon />
        </IconButton>
      </div>
      <SearchField
        className="plugins-panel-search"
        value={query}
        placeholder={t.pluginsSearch}
        aria-label={t.pluginsSearch}
        onChange={(e) => setQuery(e.target.value)}
      />
      <Presence show={menu !== null} exitMs={120}>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={addMenu(t, attempt)}
            onClose={() => setMenu(null)}
          />
        )}
      </Presence>
      <section aria-label={t.pluginsInstalledGroup}>
        <GroupHeading
          label={t.pluginsInstalledGroup}
          count={installed.length}
          open={!folded.has("installed")}
          onToggle={() => fold("installed")}
        />
        {!folded.has("installed") &&
          installed.map((record) => (
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
              picked={picked === record.id}
              onOpen={() => onPick(record.id)}
              t={t}
              // An update is the one thing to do from here: one small
              // button; other versions are on the plugin's page.
              end={
                catalog.status === "ready" && updateFor(record.id, catalog) ? (
                  <button
                    type="button"
                    className="tx-button primary plugins-panel-update"
                    disabled={installing !== null}
                    onClick={() => {
                      const item = catalog.items.find(
                        (i) => i.id === record.id,
                      );
                      if (item) void install(item);
                    }}
                  >
                    {t.pluginUpdateNow}
                  </button>
                ) : null
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
        <GroupHeading
          label={t.extensionsAvailable}
          count={catalog.status === "ready" ? offered.length : undefined}
          open={!folded.has("available")}
          onToggle={() => fold("available")}
        />
        {folded.has("available") ? null : catalog.status !== "ready" ? (
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
              picked={picked === item.id}
              onOpen={() => onPick(item.id)}
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
  picked = false,
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
  /** Its page shows beside the list. */
  picked?: boolean;
  t: Strings;
}) {
  const by = manifest?.author || manifest?.publisher;
  return (
    <div
      className="plugins-panel-row"
      data-plugin={id}
      data-off={off || undefined}
      data-picked={picked || undefined}
    >
      <button
        type="button"
        className="plugins-panel-open"
        aria-label={t.pluginOpenDetails.replace("{name}", name)}
        aria-current={picked || undefined}
        onClick={onOpen}
      >
        {icon}
        <span className="plugins-panel-text">
          <span className="plugins-panel-name">{name}</span>
          {line && <span className="plugins-panel-line">{line}</span>}
          {by && <span className="plugins-panel-by">{by}</span>}
        </span>
      </button>
      {end && <span className="plugins-panel-end">{end}</span>}
    </div>
  );
}

/** A group's heading: a button that folds it, with how many it holds. */
function GroupHeading({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="tx-list-heading plugins-panel-group"
      aria-expanded={open}
      onClick={onToggle}
    >
      <ChevronIcon className="plugins-panel-chevron" />
      {label}
      {count !== undefined && (
        <span className="plugins-panel-count">{count}</span>
      )}
    </button>
  );
}

/** The list's "+": the ways to add a plugin. */
function addMenu(
  t: Strings,
  attempt: (run: () => Promise<unknown>) => Promise<unknown>,
): ContextMenuEntry[] {
  const add = (folder: boolean) =>
    void attempt(async () => {
      const opened = await installPluginFiles(t, folder);
      if (opened) openPage(opened);
    });
  return [
    { label: t.createMakePlugin, onSelect: () => requestCreate("", "plugin") },
    ...(isDesktopApp
      ? [
          "separator" as const,
          { label: t.pluginsInstallFile, onSelect: () => add(false) },
          { label: t.pluginsLoadFolder, onSelect: () => add(true) },
          {
            label: t.pluginsOpenScripts,
            onSelect: () => void attempt(() => pluginsIpc.openScriptsDir()),
          },
        ]
      : []),
  ];
}
