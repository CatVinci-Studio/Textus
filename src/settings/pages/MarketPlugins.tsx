import { useState } from "react";
import { Byline } from "./PluginPage";
import type { Strings } from "../../i18n/strings";
import { pluginName, pluginText } from "../../plugins/manager";
import {
  loadCatalog,
  notInstalled,
  PLUGIN_PACKS,
  RECOMMENDED_PLUGINS,
  searchCatalog,
  type CatalogItem,
  type CatalogState,
  type PackId,
} from "../../plugins/store/catalog";

/** Get more › Plugins: the catalog's plugins not installed yet; with no
 *  search, the packs and the recommended ones first. */
export function MarketPlugins({
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
  onInstall: (item: CatalogItem, quietly?: boolean) => Promise<void>;
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
  const browsing = !query.trim();
  const picks = browsing
    ? RECOMMENDED_PLUGINS.flatMap((id) => shown.filter((i) => i.id === id))
    : [];
  const rest = shown.filter((i) => !picks.includes(i));
  const card = (item: CatalogItem) => (
    <CatalogCard
      key={item.id}
      item={item}
      t={t}
      installing={installing === item.id}
      onInstall={() => void onInstall(item)}
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
      {browsing && (
        <PluginPacks
          t={t}
          catalog={catalog.items}
          offered={offered}
          onInstall={onInstall}
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

const PACK_NAMES: Record<PackId, (t: Strings) => string> = {
  writing: (t) => t.packWriting,
  charts: (t) => t.packCharts,
  research: (t) => t.packResearch,
};

/** The packs the catalog has two or more plugins of: their plugins by
 *  name, and Install all for the ones not installed yet, one after another. */
function PluginPacks({
  t,
  catalog,
  offered,
  onInstall,
}: {
  t: Strings;
  catalog: CatalogItem[];
  offered: CatalogItem[];
  onInstall: (item: CatalogItem, quietly?: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState<PackId | null>(null);
  const packs = PLUGIN_PACKS.map((pack) => ({
    ...pack,
    items: pack.plugins.flatMap((id) => catalog.filter((i) => i.id === id)),
  })).filter((pack) => pack.items.length >= 2);
  if (!packs.length) return null;
  const installAll = async (id: PackId, missing: CatalogItem[]) => {
    setBusy(id);
    try {
      for (const item of missing) await onInstall(item, true);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <h4 className="plugin-subgroup-title">{t.pluginsPacks}</h4>
      <div className="settings-group-body">
        {packs.map((pack) => {
          const missing = pack.items.filter((i) => offered.includes(i));
          return (
            <div
              key={pack.id}
              className="settings-row plugin-card"
              data-pack={pack.id}
            >
              <div className="plugin-card-open">
                <span className="settings-row-label plugin-card-name">
                  {PACK_NAMES[pack.id](t)}
                </span>
                <span className="settings-row-hint plugin-card-description">
                  {pack.items
                    .map((i) => pluginName({ id: i.id, manifest: i.manifest }))
                    .join(" · ")}
                </span>
              </div>
              <div className="settings-row-control">
                <button
                  type="button"
                  className="plugin-install"
                  disabled={!missing.length || busy !== null}
                  onClick={() => void installAll(pack.id, missing)}
                >
                  {busy === pack.id
                    ? t.pluginInstalling
                    : missing.length
                      ? t.packInstallAll.replace("{n}", String(missing.length))
                      : t.packAllInstalled}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
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

/** A plugin the catalog offers, with Install, and a picture of it at work
 *  when it has one. */
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
  const name = pluginName({ id: item.id, manifest: item.manifest });
  const shot = item.screenshots[0];
  return (
    <div className="settings-row plugin-card" data-catalog={item.id}>
      <div className="plugin-card-open">
        <span className="settings-row-label plugin-card-name">{name}</span>
        <span className="settings-row-hint plugin-card-description">
          {pluginText(record, item.manifest.description)}
        </span>
        <Byline manifest={item.manifest} official={item.official} t={t} />
        {shot && (
          <img
            className="plugin-card-shot"
            src={shot}
            alt={t.pluginScreenshot.replace("{name}", name)}
            loading="lazy"
          />
        )}
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
