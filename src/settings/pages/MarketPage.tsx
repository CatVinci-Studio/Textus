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
} from "../../plugins/catalog";
import { ThemeGallerySection } from "../sections/theme-gallery";
import { MarketSkills } from "../sections/market-skills";
import { MarketMcp } from "../sections/mcp";
import type { McpServer } from "../mcp";
import { links } from "../../platform/ipc";
import { usePluginInstall } from "./usePluginInstall";

export type MarketKind = "all" | "plugins" | "themes" | "skills" | "mcp";

const KINDS: MarketKind[] = ["all", "plugins", "themes", "skills", "mcp"];

/**
 * Settings › Extensions › Get more: everything there is to add to Textus
 * in one place - the plugins textus-plugins' catalog offers, the theme
 * gallery's themes, the built-in skills that are off and the catalog's
 * skills, and the MCP servers most people add - with one search over them
 * and a filter by kind. Each installs as it does on its own tab; nothing
 * is fetched in the background, only when this page opens.
 */
export function MarketPage({
  t,
  kind: initialKind,
  onBack,
  onAddMcp,
  onInstalled,
}: {
  t: Strings;
  kind: MarketKind;
  onBack: () => void;
  /** Takes an MCP server to its tab's form, to fill in and save. */
  onAddMcp: (server: McpServer) => void;
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
  const shows = (k: MarketKind) => kind === "all" || kind === k;
  const label: Record<MarketKind, string> = {
    all: t.marketAll,
    plugins: t.extensionsTabPlugins,
    themes: t.extensionsTabThemes,
    skills: t.extensionsTabSkills,
    mcp: t.extensionsTabMcp,
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
      {shows("plugins") && (
        <section className="settings-group" aria-label={label.plugins}>
          {kind === "all" && (
            <h3 className="settings-group-title">{label.plugins}</h3>
          )}
          <MarketPlugins
            t={t}
            catalog={catalog}
            query={query}
            installing={installing}
            onInstall={(item) => void install(item)}
          />
        </section>
      )}
      {shows("themes") && (
        <section className="settings-group" aria-label={label.themes}>
          {kind === "all" && (
            <h3 className="settings-group-title">{label.themes}</h3>
          )}
          <ThemeGallerySection t={t} query={query} />
        </section>
      )}
      {shows("skills") && (
        <section className="settings-group" aria-label={label.skills}>
          {kind === "all" && (
            <h3 className="settings-group-title">{label.skills}</h3>
          )}
          <MarketSkills t={t} catalog={catalog} query={query} />
        </section>
      )}
      {shows("mcp") && (
        <section className="settings-group" aria-label={label.mcp}>
          {kind === "all" && (
            <h3 className="settings-group-title">{label.mcp}</h3>
          )}
          <MarketMcp t={t} query={query} onAdd={onAddMcp} />
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
