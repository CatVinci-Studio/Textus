import { useState, type ReactNode } from "react";
import { Byline } from "./PluginPage";
import { PluginIcon } from "./PluginArt";
import type { Strings } from "../../i18n/strings";
import { pluginName, pluginText } from "../../plugins/manager";
import {
  loadCatalog,
  searchCatalog,
  sortCatalog,
  type CatalogItem,
  type CatalogSort,
  type CatalogState,
} from "../../plugins/store/catalog";
import { Select } from "../../ui/Select";
import { AvailableSection } from "./AvailableSection";

const SORTS: CatalogSort[] = ["popular", "newest", "name"];

/** The catalog's plugins not installed yet, the most installed first (or
 *  as sorted), each opening its page. */
export function AvailablePlugins({
  t,
  catalog,
  query,
  installed,
  actionFor,
  onOpen,
}: {
  t: Strings;
  catalog: CatalogState;
  query: string;
  installed: ReadonlySet<string>;
  /** A plugin's button (PluginAction). */
  actionFor: (id: string) => ReactNode;
  onOpen: (item: CatalogItem) => void;
}) {
  const [sort, setSort] = useState<CatalogSort>("popular");
  const sortLabel: Record<CatalogSort, string> = {
    popular: t.pluginsSortPopular,
    newest: t.pluginsSortNewest,
    name: t.pluginsSortName,
  };
  const ready = catalog.status === "ready";
  const shown = ready
    ? sortCatalog(searchCatalog(catalog.items, query), sort).filter(
        (item) => !installed.has(item.id),
      )
    : [];
  const message =
    catalog.status === "failed" ? (
      <CatalogProblem
        t={t}
        text={t.pluginsCatalogFailed.replace("{reason}", catalog.error)}
      />
    ) : !ready ? (
      <p className="plugin-empty">{t.pluginsCatalogLoading}</p>
    ) : query.trim() && !shown.length ? (
      <p className="plugin-empty">
        {t.pluginsSearchNone.replace("{query}", query.trim())}
      </p>
    ) : undefined;
  return (
    <AvailableSection
      t={t}
      kind="plugins"
      searching={!!query.trim()}
      message={message}
      head={
        <div className="market-sort">
          <Select
            className="inline-chat-mode"
            aria-label={t.pluginsSortLabel}
            value={sort}
            onChange={(e) => setSort(e.target.value as CatalogSort)}
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {sortLabel[s]}
              </option>
            ))}
          </Select>
        </div>
      }
      note={
        ready &&
        catalog.error && (
          <CatalogProblem
            t={t}
            text={t.pluginsCatalogKept.replace("{reason}", catalog.error)}
          />
        )
      }
      rows={shown.map((item) => (
        <CatalogCard
          key={item.id}
          item={item}
          t={t}
          action={actionFor(item.id)}
          onOpen={() => onOpen(item)}
        />
      ))}
    />
  );
}

function CatalogProblem({ t, text }: { t: Strings; text: string }) {
  return (
    <div className="settings-row plugin-catalog-problem">
      <div className="settings-row-text">
        <div className="settings-error">{text}</div>
      </div>
      <div className="settings-row-control">
        <button type="button" onClick={() => void loadCatalog(true)}>
          {t.pluginsCatalogRetry}
        </button>
      </div>
    </div>
  );
}

/** "1,234 installs", in the UI language's digits; nothing when uncounted. */
export function installsText(item: CatalogItem, t: Strings): string | null {
  if (item.installs === undefined) return null;
  return t.pluginInstalls.replace("{n}", item.installs.toLocaleString());
}

/** A plugin the catalog offers: its icon, name, line and installs, opening
 *  its page; its button beside it. */
function CatalogCard({
  item,
  t,
  action,
  onOpen,
}: {
  item: CatalogItem;
  t: Strings;
  action: ReactNode;
  onOpen: () => void;
}) {
  const name = pluginName({ id: item.id, manifest: item.manifest });
  const installs = installsText(item, t);
  return (
    <div className="settings-row plugin-card" data-catalog={item.id}>
      <button
        type="button"
        className="plugin-card-open plugin-card-with-icon"
        aria-label={t.pluginOpenDetails.replace("{name}", name)}
        onClick={onOpen}
      >
        <PluginIcon id={item.id} manifest={item.manifest} url={item.icon} />
        <span className="plugin-card-text">
          <span className="settings-row-label plugin-card-name">{name}</span>
          <span className="settings-row-hint plugin-card-description">
            {pluginText({ manifest: item.manifest }, item.manifest.description)}
          </span>
          <Byline manifest={item.manifest} official={item.official} t={t}>
            {installs && <span className="plugin-installs">{installs}</span>}
          </Byline>
        </span>
      </button>
      <div className="settings-row-control">{action}</div>
    </div>
  );
}
