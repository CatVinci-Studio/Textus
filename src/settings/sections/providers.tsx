import { showQuickPick } from "../../engine/controls/quick-pick-queue";
import { useState } from "react";
import type { Strings } from "../../i18n/strings";
import type { AiProvider } from "../../prefs/SettingsContext";
import { useSettings } from "../../prefs/SettingsContext";
import { useProviderCatalog } from "../../ai/provider-catalog";
import { ChevronIcon } from "../../engine/controls/icons";
import { useSettingsConnected } from "./provider-connection";
import { localizedLabel } from "../../ai/provider-connection";
import { ProviderAuthPanel } from "./provider-auth";
import { CustomProviderPanel } from "./custom-provider";

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
  const [authOpen, setAuthOpen] = useState(expandCredentials);
  const { connected, refreshConnected, isConnected } = useSettingsConnected(
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

  async function pickProvider() {
    const picked = await showQuickPick(
      catalog.map((entry) => {
        const state = connected[entry.id];
        return {
          label: localizedLabel(entry, t),
          // The provider's id finds it too ("moonshot" for Kimi).
          description: [
            entry.id,
            state?.oauth || state?.apiKey ? t.accountConnectedAs : "",
          ]
            .filter(Boolean)
            .join(" · "),
          value: entry.id,
        };
      }),
      t.providerSearchPlaceholder,
    );
    if (typeof picked !== "string") return;
    setSettings({ aiProvider: picked as AiProvider });
    setAuthOpen(expandCredentials);
  }

  return (
    <div className="provider-picker">
      <button
        type="button"
        className="combobox-trigger"
        aria-haspopup="dialog"
        onClick={() => void pickProvider()}
      >
        <span className="provider-disclosure-label">
          {t.providerDropdownLabel}
        </span>{" "}
        <span className="combobox-trigger-label">
          {active ? localizedLabel(active, t) : settings.aiProvider}
        </span>
        <ChevronIcon className="combobox-caret" />
      </button>

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
