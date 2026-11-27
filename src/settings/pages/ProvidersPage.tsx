import { useState } from "react";
import type { SettingsPageProps } from "./types";
import type { ProviderCatalogEntry } from "../../ai/provider-catalog";
import { useProviderCatalog } from "../../ai/provider-catalog";
import { ProviderLogo } from "../../ai/provider-logos/ProviderLogo";
import type { Strings } from "../../i18n/strings";
import {
  localizedLabel,
  type ConnectedState,
} from "../../ai/provider-connection";
import { useSettingsConnected } from "../sections/provider-connection";
import { ProviderAuthPanel } from "../sections/provider-auth";
import { CustomProviderPanel } from "../sections/custom-provider";
import { ModelListRow, useModelListShown } from "../sections/agent";
import { SettingsGroup } from "./SettingsGroup";
import "./providers-page.css";
import { ModelChoices } from "./ModelChoices";
import { PlusIcon } from "../../engine/controls/icons";
import { isCustomEntry, useCustomEndpoints } from "../../ai/custom-endpoints";

/** What the list has picked to add a custom endpoint, in place of an id. */
const NEW_ENDPOINT = "";

/**
 * Settings › Textus AI › Providers: every provider in a list - its logo,
 * a dot once it is set up - and beside it the one picked: how to sign in
 * or its key, its address, and its models. Which provider each use takes
 * is chosen on Chat & writing; picking one here changes none of that.
 */
export function ProvidersPage({ t, settings }: SettingsPageProps) {
  const catalog = useProviderCatalog();
  const [picked, setPicked] = useState<string>(settings.aiProvider);
  const { connected, refreshConnected } = useSettingsConnected(
    catalog,
    settings.aiProvider,
  );
  const adding = picked === NEW_ENDPOINT;
  const entry = adding
    ? undefined
    : (catalog.find((e) => e.id === picked) ?? catalog[0]);
  return (
    <>
      <ModelChoices t={t} />
      {/* One panel: the list on the left, the picked one's sign-in and
          models on the right, nothing boxed inside it. */}
      <SettingsGroup title={t.providersGroup}>
        <div className="providers-page">
          <div className="providers-list">
            {catalog.map((e) => (
              <button
                key={e.id}
                type="button"
                className="tx-list-item providers-item"
                aria-current={e.id === entry?.id || undefined}
                onClick={() => setPicked(e.id)}
              >
                <ProviderLogo id={e.id} label={localizedLabel(e, t)} />
                <span className="tx-truncate providers-item-name">
                  {localizedLabel(e, t)}
                </span>
                {/* Set up by the user: a key or an account. A provider that
                    needs neither (a local Ollama) shows nothing it can't
                    know. */}
                {!e.keyOptional && isSetUp(connected[e.id]) && (
                  <span
                    className="status-dot"
                    aria-label={t.apiKeyConfigured}
                  />
                )}
              </button>
            ))}
            {/* The user's own endpoints are listed above with the rest. */}
            <button
              type="button"
              className="tx-list-item providers-item"
              aria-current={adding || undefined}
              onClick={() => setPicked(NEW_ENDPOINT)}
            >
              <span className="provider-logo" aria-hidden="true">
                <PlusIcon />
              </span>
              <span className="tx-truncate providers-item-name">
                {t.customEndpointAdd}
              </span>
            </button>
          </div>
          {(entry || adding) && (
            <ProviderDetail
              key={entry?.id ?? NEW_ENDPOINT}
              t={t}
              entry={entry}
              connected={entry && connected[entry.id]}
              onStatusChange={() => entry && refreshConnected(entry)}
              onPicked={(id) => setPicked(id ?? catalog[0]?.id ?? "")}
            />
          )}
        </div>
      </SettingsGroup>
    </>
  );
}

const isSetUp = (state?: ConnectedState) => !!(state?.oauth || state?.apiKey);

/** One provider: its name and state, how it is reached, its models. With
 *  no `entry`, a custom endpoint being added. */
function ProviderDetail({
  t,
  entry,
  connected,
  onStatusChange,
  onPicked,
}: {
  t: Strings;
  entry?: ProviderCatalogEntry;
  connected?: ConnectedState;
  onStatusChange: () => void;
  /** Moves the list to an endpoint just saved, or off one removed. */
  onPicked: (id: string | null) => void;
}) {
  const custom = !entry || isCustomEntry(entry);
  // Its state is said on its sign-in row; one with nothing to sign in to
  // says it here instead.
  const status =
    entry?.keyOptional && !custom ? t.providerNoKeyRequired : undefined;
  const listShown = useModelListShown(entry?.id ?? NEW_ENDPOINT);
  const endpoint = useCustomEndpoints().find((e) => e.id === entry?.id);
  return (
    <div className="providers-detail">
      <SettingsGroup title={status}>
        {custom || !entry ? (
          <CustomProviderPanel
            t={t}
            endpoint={endpoint}
            onSaved={onPicked}
            onRemoved={() => onPicked(null)}
          />
        ) : (
          <ProviderAuthPanel
            t={t}
            entry={entry}
            connected={connected}
            onStatusChange={onStatusChange}
          />
        )}
      </SettingsGroup>
      {listShown && entry && !custom && (
        <SettingsGroup title={t.providerModelsGroup}>
          <ModelListRow t={t} provider={entry.id} />
        </SettingsGroup>
      )}
      <p className="providers-note">{t.providerKeysLocal}</p>
    </div>
  );
}
