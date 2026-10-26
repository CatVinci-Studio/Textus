import { useId, useState } from "react";
import type { Strings } from "../../i18n/strings";
import type { AiProvider } from "../SettingsContext";
import { useSettings } from "../SettingsContext";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";
import { useProviderCatalog } from "../../ai/provider-catalog";
import { ChevronIcon } from "../../ui/icons";
import { isIOSApp } from "../../platform/capabilities";
import {
  localizedLabel,
  useConnectedProviders,
  useProviderSearch,
} from "./provider-connection";
import { CustomProviderPanel, ProviderAuthPanel } from "./provider-auth";
export {
  ProviderAuthPanel,
  ApiKeyProviderPanel,
  CustomProviderPanel,
} from "./provider-auth";

/// Two compact rows: a searchable provider list, then the active provider's
/// credentials. The tutorial's connect lesson embeds this same panel.
export function ProviderListPanel({
  t,
  expandCredentials = false,
  onActiveConnectedChange,
}: {
  t: Strings;
  expandCredentials?: boolean;
  onActiveConnectedChange?: (connected: boolean) => void;
}) {
  const { settings, setSettings } = useSettings();
  const catalog = useProviderCatalog();
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const [authOpen, setAuthOpen] = useState(expandCredentials);
  const { query, setQuery, filtered } = useProviderSearch(catalog, t);
  const popoverRef = useCloseOnOutsideClick<HTMLDivElement>(
    () => setOpen(false),
    true,
    open,
  );
  const { connected, refreshConnected, isConnected } = useConnectedProviders(
    catalog,
    settings.aiProvider,
    onActiveConnectedChange,
  );

  // A plain find: useActiveProvider would subscribe to the catalog again.
  const active = catalog.find((e) => e.id === settings.aiProvider);
  const usesAccountStatus = active?.auth.includes("oauth") ?? false;
  const statusLabel =
    active?.keyOptional && active.id !== "custom"
      ? t.providerNoKeyRequired
      : isConnected
        ? usesAccountStatus
          ? t.accountConnectedAs
          : t.apiKeyConfigured
        : usesAccountStatus
          ? t.accountNotConnected
          : t.providerNotConfigured;

  function selectProvider(id: AiProvider) {
    setSettings({ aiProvider: id });
    setOpen(false);
    setAuthOpen(expandCredentials);
    setQuery("");
    popoverRef.current
      ?.querySelector<HTMLButtonElement>(".combobox-trigger")
      ?.focus();
  }

  return (
    <div className="provider-picker">
      <div
        className="combobox"
        ref={popoverRef}
        onKeyDown={(event) => {
          if (
            open &&
            event.key === "Escape" &&
            !event.nativeEvent.isComposing &&
            event.nativeEvent.keyCode !== 229
          ) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            popoverRef.current
              ?.querySelector<HTMLButtonElement>(".combobox-trigger")
              ?.focus();
          }
        }}
      >
        <button
          type="button"
          className="combobox-trigger"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="provider-disclosure-label">
            {t.providerDropdownLabel}
          </span>{" "}
          <span className="combobox-trigger-label">
            {active ? localizedLabel(active, t) : settings.aiProvider}
          </span>
          <ChevronIcon className="combobox-caret" />
        </button>
        {open && (
          <div className="combobox-popover" id={popoverId}>
            <input
              type="text"
              className="combobox-search"
              aria-label={t.providerSearchPlaceholder}
              placeholder={t.providerSearchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // On a phone the keyboard would rise over half the list the
              // moment it opened; the field is there for when it's wanted.
              autoFocus={!isIOSApp}
            />
            <div className="combobox-list">
              {filtered.length === 0 && (
                <div className="combobox-empty">{t.noProvidersFound}</div>
              )}
              {filtered.map((entry) => {
                const state = connected[entry.id];
                const connectedHere = !!(state?.oauth || state?.apiKey);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={`combobox-option${entry.id === settings.aiProvider ? " combobox-option-active" : ""}`}
                    onClick={() => selectProvider(entry.id)}
                  >
                    <span className="combobox-option-label">
                      {localizedLabel(entry, t)}
                    </span>
                    {connectedHere && (
                      <span className="status-dot" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {active && (
        <>
          <button
            type="button"
            className="provider-auth-trigger"
            onClick={() => setAuthOpen((v) => !v)}
            aria-expanded={authOpen}
          >
            <span className="provider-disclosure-label">
              {t.authDropdownLabel}
            </span>{" "}
            <span
              className={`status-pill${isConnected ? " status-pill-connected" : ""}`}
            >
              {statusLabel}
            </span>
            <ChevronIcon
              className={`combobox-caret${authOpen ? " combobox-caret-open" : ""}`}
            />
          </button>
          {authOpen && (
            <div className="provider-panel">
              {active.id === "custom" ? (
                <CustomProviderPanel
                  t={t}
                  onStatusChange={() => refreshConnected(active)}
                />
              ) : (
                <ProviderAuthPanel
                  key={active.id}
                  t={t}
                  entry={active}
                  connected={connected[active.id]}
                  onStatusChange={() => refreshConnected(active)}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
