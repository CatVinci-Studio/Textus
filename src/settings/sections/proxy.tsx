import type { SettingsPageProps } from "../pages/types";
import type { ProxyType } from "../../prefs/SettingsContext";
import { SettingRow, VERBATIM_INPUT } from "./controls";
import { Select } from "../../engine/controls/Select";

/** Settings › General › Network: where every request the app makes goes
 *  (updates, the plugin and theme stores, Git, the AI and its search). By
 *  default the system's proxy, as a browser follows it. */
export function ProxySection({
  t,
  settings,
  setSettings,
}: Pick<SettingsPageProps, "t" | "settings" | "setSettings">) {
  const manual = !["system", "direct"].includes(settings.proxyType);
  const help =
    settings.proxyType === "system"
      ? t.proxySystemHelp
      : manual
        ? t.proxyAuthHelp
        : undefined;
  return (
    <>
      <SettingRow label={t.proxyLabel} help={help}>
        <Select
          className="settings-select"
          aria-label={t.proxyLabel}
          value={settings.proxyType}
          onChange={(e) =>
            setSettings({ proxyType: e.target.value as ProxyType })
          }
        >
          <option value="system">{t.proxyTypeSystem}</option>
          <option value="direct">{t.proxyTypeNone}</option>
          <option value="http">HTTP</option>
          <option value="https">HTTPS</option>
          <option value="socks5">SOCKS5</option>
        </Select>
      </SettingRow>
      {manual && (
        <>
          <div className="settings-proxy-row">
            <input
              type="text"
              inputMode="url"
              {...VERBATIM_INPUT}
              className="tx-input settings-text-input settings-proxy-host"
              placeholder={t.proxyHostPlaceholder}
              aria-label={t.proxyHostPlaceholder}
              value={settings.proxyHost}
              onChange={(e) => setSettings({ proxyHost: e.target.value })}
            />
            <input
              type="text"
              inputMode="numeric"
              {...VERBATIM_INPUT}
              className="tx-input settings-text-input settings-proxy-port"
              placeholder={t.proxyPortPlaceholder}
              aria-label={t.proxyPortPlaceholder}
              value={settings.proxyPort}
              onChange={(e) => setSettings({ proxyPort: e.target.value })}
            />
          </div>
          <div className="settings-proxy-row">
            <input
              type="text"
              {...VERBATIM_INPUT}
              autoComplete="off"
              className="tx-input settings-text-input settings-proxy-host"
              placeholder={t.proxyUserPlaceholder}
              aria-label={t.proxyUserPlaceholder}
              value={settings.proxyUsername}
              onChange={(e) => setSettings({ proxyUsername: e.target.value })}
            />
            <input
              type="password"
              {...VERBATIM_INPUT}
              autoComplete="off"
              className="tx-input settings-text-input settings-proxy-host"
              placeholder={t.proxyPasswordPlaceholder}
              aria-label={t.proxyPasswordPlaceholder}
              value={settings.proxyPassword}
              onChange={(e) => setSettings({ proxyPassword: e.target.value })}
            />
          </div>
        </>
      )}
    </>
  );
}
