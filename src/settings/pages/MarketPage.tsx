import { useEffect, useState, useSyncExternalStore } from "react";
import { Byline } from "./PluginPage";
import type { Strings } from "../../i18n/strings";
import { pluginName, pluginText } from "../../plugins/manager";
import {
  catalogSnapshot,
  loadCatalog,
  notInstalled,
  RECOMMENDED_PLUGINS,
  searchCatalog,
  subscribeCatalog,
  type CatalogItem,
  type CatalogState,
} from "../../plugins/store/catalog";
import { ThemeGallerySection } from "../sections/theme-gallery";
import { MarketSkills } from "../sections/market-skills";
import { links } from "../../platform/ipc";
import { usePluginInstall } from "./usePluginInstall";

export type MarketKind = "themes" | "plugins" | "skills";

const KINDS: MarketKind[] = ["themes", "plugins", "skills"];

/**
 * Settings › Extensions › Get more: what there is to add to Textus, a tab
 * per kind - the theme gallery's themes, the plugins textus-plugins'
 * catalog offers, the catalog's skills - each with its search. MCP servers
 * aren't here: the user adds the ones they want on the MCP tab. Nothing is
 * fetched in the background, only when this page opens.
 */
export function MarketPage({
  t,
  kind: initialKind,
  onBack,
  onInstalled,
}: {
  t: Strings;
  kind: MarketKind;
  onBack: () => void;
  /** A plugin installed from here. */
  onInstalled: (id: string) => void;
}) {
  const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot);
  const { installing, install } = usePluginInstall(t, onInstalled);
  const [kind, setKind] = useState<MarketKind>(initialKind);
  const [query, setQuery] = useState("");
  useEffect(() => {
    void loadCatalog();
  }, []);
  const label: Record<MarketKind, string> = {
    themes: t.extensionsTabThemes,
    plugins: t.extensionsTabPlugins,
    skills: t.extensionsTabSkills,
  };
  return (
    <div className="plugin-page plugin-get-page market-page">
      <button type="button" className="plugin-back" onClick={onBack}>
        ‹ {t.navExtensions}
      </button>
      <h2 className="plugin-page-title">{t.marketTitle}</h2>
      <p className="plugin-group-help">{t.marketHelp}</p>
      <div
        className="auth-tabs market-kinds"
        role="tablist"
        aria-label={t.marketTitle}
      >
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className={`auth-tab${kind === k ? " auth-tab-active" : ""}`}
            onClick={() => setKind(k)}
          >
            {label[k]}
          </button>
        ))}
      </div>
      <input
        type="search"
        className="plugin-search"
        placeholder={t.marketSearch}
        aria-label={t.marketSearch}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {kind === "themes" && (
        <section className="settings-group" aria-label={label.themes}>
          <ThemeGallerySection t={t} query={query} />
        </section>
      )}
      {kind === "plugins" && (
        <section className="settings-group" aria-label={label.plugins}>
          <MarketPlugins
            t={t}
            catalog={catalog}
            query={query}
            installing={installing}
            onInstall={(item) => void install(item)}
          />
        </section>
      )}
      {kind === "skills" && (
        <section className="settings-group" aria-label={label.skills}>
          <MarketSkills t={t} catalog={catalog} query={query} />
        </section>
      )}
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
    </div>
  );
}

/** The catalog's plugins not installed yet, as far as `query` lets. */
function MarketPlugins({
  t,
  catalog,
  query,
  installing,
  onInstall,
}: {
  t: Strings;
  catalog: CatalogState;
  query: string;
  installing: string | null;
  onInstall: (item: CatalogItem) => void;
}) {
  if (catalog.status === "failed")
    return (
      <CatalogProblem
        t={t}
        text={t.pluginsCatalogFailed.replace("{reason}", catalog.error)}
      />
    );
  if (catalog.status !== "ready")
    return <p className="plugin-empty">{t.pluginsCatalogLoading}</p>;
  const offered = notInstalled(catalog);
  const shown = searchCatalog(offered, query);
  // The recommended ones lead while nothing is searched for.
  const picks = query.trim()
    ? []
    : RECOMMENDED_PLUGINS.flatMap((id) => shown.filter((i) => i.id === id));
  const rest = shown.filter((i) => !picks.includes(i));
  const card = (item: CatalogItem) => (
    <CatalogCard
      key={item.id}
      item={item}
      t={t}
      installing={installing === item.id}
      onInstall={() => onInstall(item)}
    />
  );
  return (
    <>
      {catalog.error && (
        <CatalogProblem
          t={t}
          text={t.pluginsCatalogKept.replace("{reason}", catalog.error)}
        />
      )}
      {picks.length > 0 && (
        <>
          <h4 className="plugin-subgroup-title">{t.pluginsRecommended}</h4>
          <div className="settings-group-body market-recommended">
            {picks.map(card)}
          </div>
          {rest.length > 0 && (
            <h4 className="plugin-subgroup-title">{t.pluginsMore}</h4>
          )}
        </>
      )}
      <div className="settings-group-body">
        {shown.length ? (
          rest.map(card)
        ) : (
          <p className="plugin-empty">
            {offered.length
              ? t.pluginsSearchNone.replace("{query}", query.trim())
              : t.pluginsCatalogAllInstalled}
          </p>
        )}
      </div>
    </>
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
