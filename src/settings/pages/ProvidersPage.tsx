import { useState } from "react";
import type { SettingsPageProps } from "./types";
import type { ProviderCatalogEntry } from "../../ai/provider-catalog";
import { useProviderCatalog } from "../../ai/provider-catalog";
import { ProviderLogo } from "../../ai/provider-logos/ProviderLogo";
import { SearchField } from "../../engine/controls/SearchField";
import type { Strings } from "../../i18n/strings";
import {
  localizedLabel,
  useConnectedProviders,
  useProviderSearch,
  type ConnectedState,
} from "../sections/provider-connection";
import {
  CustomProviderPanel,
  ProviderAuthPanel,
} from "../sections/provider-auth";
import { ModelListRow, ProviderModelPicker } from "../sections/agent";
import { SettingsGroup } from "./SettingsGroup";
import "./providers-page.css";

/**
 * Settings › Textus AI › Providers: every provider in a list - its logo,
 * a dot once it is set up - and beside it the one picked: how to sign in
 * or its key, its address, and its models. Which provider each use takes
 * is chosen on Chat & Writing; picking one here changes none of that.
 */
export function ProvidersPage({ t, settings }: SettingsPageProps) {
  const catalog = useProviderCatalog();
  const [picked, setPicked] = useState<string>(settings.aiProvider);
  const { query, setQuery, filtered } = useProviderSearch(catalog, t);
  const { connected, refreshConnected } = useConnectedProviders(
    catalog,
    settings.aiProvider,
  );
  const entry = catalog.find((e) => e.id === picked) ?? catalog[0];
  return (
    <div className="providers-page">
      <div className="providers-list">
        <div className="tx-pane-top">
          <SearchField
            value={query}
            placeholder={t.providerSearchPlaceholder}
            aria-label={t.providerSearchPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {filtered.length === 0 && (
          <p className="tx-list-note">{t.noProvidersFound}</p>
        )}
        {filtered.map((e) => (
          <button
            key={e.id}
            type="button"
            className="tx-list-item providers-item"
            aria-current={e.id === entry?.id || undefined}
            onClick={() => setPicked(e.id)}
          >
            <ProviderLogo id={e.id} label={localizedLabel(e, t)} />
            <span className="providers-item-name">{localizedLabel(e, t)}</span>
            {isSetUp(connected[e.id]) && (
              <span className="status-dot" aria-label={t.apiKeyConfigured} />
            )}
          </button>
        ))}
      </div>
      {entry && (
        <ProviderDetail
          key={entry.id}
          t={t}
          entry={entry}
          connected={connected[entry.id]}
          onStatusChange={() => refreshConnected(entry)}
        />
      )}
    </div>
  );
}

const isSetUp = (state?: ConnectedState) => !!(state?.oauth || state?.apiKey);

/** One provider: its name and state, how it is reached, its models. */
function ProviderDetail({
  t,
  entry,
  connected,
  onStatusChange,
}: {
  t: Strings;
  entry: ProviderCatalogEntry;
  connected?: ConnectedState;
  onStatusChange: () => void;
}) {
  const label = localizedLabel(entry, t);
  const status =
    entry.keyOptional && entry.id !== "custom"
      ? t.providerNoKeyRequired
      : isSetUp(connected)
        ? entry.auth.includes("oauth")
          ? t.accountConnectedAs
          : t.apiKeyConfigured
        : entry.auth.includes("oauth")
          ? t.accountNotConnected
          : t.providerNotConfigured;
  return (
    <div className="providers-detail">
      <div className="providers-head">
        <ProviderLogo id={entry.id} label={label} />
        <div>
          <div className="providers-head-name">{label}</div>
          <div className="providers-head-status">{status}</div>
        </div>
      </div>
      <SettingsGroup>
        {entry.id === "custom" ? (
          <CustomProviderPanel t={t} onStatusChange={onStatusChange} />
        ) : (
          <ProviderAuthPanel
            t={t}
            entry={entry}
            connected={connected}
            onStatusChange={onStatusChange}
          />
        )}
      </SettingsGroup>
      <SettingsGroup title={t.providerModelsGroup}>
        <ProviderModelPicker
          t={t}
          provider={entry.id}
          kind="agent"
          label={t.agentModelLabel}
        />
        <ProviderModelPicker
          t={t}
          provider={entry.id}
          kind="writing"
          label={t.writingModelLabel}
        />
        <ModelListRow t={t} provider={entry.id} />
      </SettingsGroup>
      <p className="providers-note">{t.providerKeysLocal}</p>
    </div>
  );
}
