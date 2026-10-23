import { useState } from "react";
import { Byline } from "./PluginPage";
import type { Strings } from "../../i18n/strings";
import { pluginName, pluginText } from "../../plugins/manager";
import {
  loadCatalog,
  notInstalled,
  searchCatalog,
  type CatalogItem,
  type CatalogState,
} from "../../plugins/catalog";

/**
 * Settings › Extensions › Plugins › Get plugins: the catalog's plugins not
 * installed yet, on a page of their own, with a search over their names,
 * what they do and who made them. The list is the one kept from last time
 * until a fresh one comes (plugins/catalog.ts), so it is there at once.
 */
export function GetPluginsPage({
  t,
  catalog,
  installing,
  onBack,
  onInstall,
}: {
  t: Strings;
  catalog: CatalogState;
  installing: string | null;
  onBack: () => void;
  onInstall: (item: CatalogItem) => void;
}) {
  const [query, setQuery] = useState("");
  const offered = notInstalled(catalog);
  const shown = searchCatalog(offered, query);
  return (
    <div className="plugin-page plugin-get-page">
      <button type="button" className="plugin-back" onClick={onBack}>
        ‹ {t.pluginBackToList}
      </button>
      <h2 className="plugin-page-title">{t.pluginsGetGroup}</h2>
      <p className="plugin-group-help">{t.pluginsGetHelp}</p>
      {catalog.status === "failed" ? (
        <CatalogProblem
          t={t}
          text={t.pluginsCatalogFailed.replace("{reason}", catalog.error)}
        />
      ) : catalog.status !== "ready" ? (
        <p className="plugin-empty">{t.pluginsCatalogLoading}</p>
      ) : (
        <>
          {catalog.error && (
            <CatalogProblem
              t={t}
              text={t.pluginsCatalogKept.replace("{reason}", catalog.error)}
            />
          )}
          {offered.length > 0 && (
            <input
              type="search"
              className="plugin-search"
              placeholder={t.pluginsSearch}
              aria-label={t.pluginsSearch}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <div className="settings-group-body">
            {shown.length ? (
              shown.map((item) => (
                <CatalogCard
                  key={item.id}
                  item={item}
                  t={t}
                  installing={installing === item.id}
                  onInstall={() => onInstall(item)}
                />
              ))
            ) : (
              <p className="plugin-empty">
                {offered.length
                  ? t.pluginsSearchNone.replace("{query}", query.trim())
                  : t.pluginsCatalogAllInstalled}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Why the list couldn't be fetched, with Try again. */
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
