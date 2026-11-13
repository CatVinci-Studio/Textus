import { pluginLead } from "./plugin-lead";
import { useMutedCards } from "../../plugins/store/usePluginCard";
import { setAllPlugins } from "../../plugins/plugin-switches";
import { catalogMessage, catalogStatus } from "./CatalogStatus";
import { fill } from "../../i18n/fill";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { SearchField } from "../../engine/controls/SearchField";
import {
  ChevronIcon,
  DownloadIcon,
  MoreIcon,
  RefreshIcon,
} from "../../engine/controls/icons";
import { Tooltip } from "../../engine/controls/Tooltip";
import { useMenuButton } from "../../engine/controls/useMenuButton";
import type { ContextMenuEntry } from "../../engine/controls/ContextMenu";
import { requestCreate } from "../../ai/chat/create-request";
import { isDesktopApp } from "../../platform/capabilities";
import { plugins as pluginsIpc } from "../../platform/ipc";
import { installPluginFiles } from "./PluginsPage";
import { emitToThisWindow } from "../../platform/menu-events";
import {
  pluginName,
  pluginText,
  pluginsSnapshot,
  subscribePlugins,
} from "../../plugins/store/plugin-records";
import {
  catalogSnapshot,
  loadCatalog,
  offeredItems,
  searchCatalog,
  sortCatalog,
  subscribeCatalog,
  updateFor,
  catalogItem,
  neededTextus,
} from "../../plugins/store/catalog";
import { pluginMatches } from "../../plugins/store/plugin-records";
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
 * page in a tab. Beside the search, "⋯" adds one; "update all" sits on
 * the installed group's heading while two or more have updates.
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
  const { install, installing, attempt, updateAll } = usePluginActions(t);
  const muted = useMutedCards();
  const more = useMenuButton(() =>
    moreMenu(t, attempt, { allOn: plugins.allOn, muted }),
  );
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
      <div className="tx-pane-row">
        <SearchField
          className="plugins-panel-search"
          value={query}
          placeholder={t.pluginsSearch}
          aria-label={t.pluginsSearch}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Tooltip text={t.pluginsMore}>
          <button
            type="button"
            className="tree-tool plugins-panel-more"
            aria-label={t.pluginsMore}
            {...more.button}
          >
            <MoreIcon />
          </button>
        </Tooltip>
      </div>
      {more.menu}
      <section aria-label={t.pluginsInstalledGroup}>
        <GroupHeading
          label={t.pluginsInstalledGroup}
          count={installed.length}
          open={!folded.has("installed")}
          onToggle={() => fold("installed")}
          // Two or more to update: all of them at once (one has its own).
          action={
            updates.length > 1 && (
              <button
                type="button"
                className="text-button plugins-panel-update-all"
                disabled={installing !== null}
                onClick={() => void updateAll(updates)}
              >
                {fill(t.pluginsUpdateAll, { count: String(updates.length) })}
              </button>
            )
          }
        />
        {!folded.has("installed") && !installed.length && (
          <p className="tx-list-note">{t.pluginsInstalledNone}</p>
        )}
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
              off={record.status !== "on"}
              picked={picked === record.id}
              onOpen={() => onPick(record.id)}
              // An update is the one thing to do from here: one small
              // button; other versions are on the plugin's page.
              end={
                catalog.status === "ready" && updateFor(record.id, catalog) ? (
                  <RowButton
                    label={`${t.pluginUpdateNow} · ${pluginName(record)}`}
                    tip={t.pluginUpdateNow}
                    update
                    disabled={installing !== null}
                    onClick={() => {
                      const item = catalogItem(record.id, catalog);
                      if (item) void install(item);
                    }}
                  />
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
        {folded.has("available")
          ? null
          : (catalogMessage({
              t,
              status: catalogStatus(catalog),
              error: catalog.status === "failed" ? catalog.error : undefined,
              query,
              shown: offered.length,
            }) ??
            offered.map((item) => (
              <PluginRow
                key={item.id}
                id={item.id}
                name={pluginName({ id: item.id, manifest: item.manifest })}
                line={pluginText(
                  { manifest: item.manifest },
                  item.manifest.description,
                )}
                picked={picked === item.id}
                onOpen={() => onPick(item.id)}
                end={
                  neededTextus(item) ? null : (
                    <RowButton
                      label={`${t.pluginInstall} · ${pluginName({ id: item.id, manifest: item.manifest })}`}
                      tip={
                        installing === item.id
                          ? t.pluginInstalling
                          : t.pluginInstall
                      }
                      disabled={installing !== null}
                      onClick={() => void install(item)}
                    />
                  )
                }
                icon={
                  <PluginIcon
                    id={item.id}
                    manifest={item.manifest}
                    url={item.icon}
                  />
                }
              />
            )))}
      </section>
    </div>
  );
}

function PluginRow({
  id,
  name,
  line,
  off = false,
  icon,
  end,
  onOpen,
  picked = false,
}: {
  id: string;
  name: string;
  line: string;
  off?: boolean;
  icon: ReactNode;
  /** Its button: install, or update. */
  end: ReactNode;
  onOpen: () => void;
  /** Its page shows beside the list. */
  picked?: boolean;
}) {
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
        aria-current={picked || undefined}
        onClick={onOpen}
      >
        {icon}
        <span className="plugins-panel-text">
          <span className="tx-truncate plugins-panel-name">{name}</span>
          {line && (
            <span className="tx-truncate plugins-panel-line">
              {pluginLead(line)}
            </span>
          )}
        </span>
      </button>
      {/* Who made it is on its page. */}
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
  action,
}: {
  label: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  /** What acts on the whole group, at its end. */
  action?: ReactNode;
}) {
  return (
    <div className="plugins-panel-group-row">
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
      {action}
    </div>
  );
}

/** The list's "⋯": add a plugin - from a file or a folder in development,
 *  by making one, or as a script - and what acts on all of them: plugin
 *  features on or off, suggestions put away brought back. */
function moreMenu(
  t: Strings,
  attempt: (run: () => Promise<unknown>) => Promise<unknown>,
  {
    allOn,
    muted,
  }: { allOn: boolean; muted: { count: number; restore: () => void } },
): ContextMenuEntry[] {
  const fromFiles = (folder: boolean) =>
    void attempt(async () => {
      const opened = await installPluginFiles(t, folder);
      if (opened) openPage(opened);
    });
  return [
    ...(isDesktopApp
      ? [
          { label: t.pluginsInstallFile, onSelect: () => fromFiles(false) },
          { label: t.pluginsLoadFolder, onSelect: () => fromFiles(true) },
        ]
      : []),
    { label: t.createMakePlugin, onSelect: () => requestCreate("", "plugin") },
    ...(isDesktopApp
      ? [
          {
            label: t.pluginsOpenScripts,
            onSelect: () => void attempt(() => pluginsIpc.openScriptsDir()),
          },
        ]
      : []),
    "separator" as const,
    {
      label: t.pluginsAllLabel,
      checked: allOn,
      onSelect: () => void attempt(() => setAllPlugins(!allOn)),
    },
    ...(muted.count
      ? [{ label: t.pluginCardsRestoreAll, onSelect: muted.restore }]
      : []),
  ];
}

/** A row's one action, as a small round button: the words keep the row.
 *  An update turns, in the accent: something to do, not something to get. */
function RowButton({
  label,
  tip,
  update = false,
  disabled,
  onClick,
}: {
  label: string;
  tip: string;
  update?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip text={tip}>
      <button
        type="button"
        className="tree-tool plugins-panel-action"
        data-update={update || undefined}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        {update ? <RefreshIcon /> : <DownloadIcon />}
      </button>
    </Tooltip>
  );
}
