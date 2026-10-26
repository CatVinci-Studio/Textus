import { useEffect, useState, useSyncExternalStore } from "react";
import type { Strings } from "../../i18n/strings";
import {
  catalogSnapshot,
  loadCatalog,
  subscribeCatalog,
} from "../../plugins/store/catalog";
import { MarketPlugins } from "./MarketPlugins";
import { ThemeGallerySection } from "../sections/theme-gallery";
import { MarketSkills } from "../sections/market-skills";
import { links } from "../../platform/ipc";
import { usePluginInstall } from "./usePluginInstall";

export type MarketKind = "themes" | "plugins" | "skills";

const KINDS: MarketKind[] = ["themes", "plugins", "skills"];

/** Settings › Extensions › Get more: themes, plugins and skills to add, a
 *  tab per kind with its search. Fetched only when this page opens. */
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
            onInstall={install}
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
