import { Byline } from "./PluginPage";
import { PluginIcon, PluginReadme } from "./PluginArt";
import type { ReactNode } from "react";
import { installsText } from "./installs-text";
import { SettingsGroup } from "./SettingsGroup";
import { SettingRow } from "../sections/controls";
import type { Strings } from "../../i18n/strings";
import { pluginName, pluginText } from "../../plugins/manager";
import { permissionLabel } from "../../plugins/store/permissions";
import type { CatalogItem } from "../../plugins/store/catalog";

/** A catalog plugin's page in Get more, before it is installed: what it
 *  is, its pictures, its README and the permissions it will ask for. */
export function MarketPluginPage({
  item,
  t,
  installed,
  action,
  onBack,
}: {
  item: CatalogItem;
  t: Strings;
  installed: boolean;
  /** Its button (PluginAction). */
  action: ReactNode;
  onBack: () => void;
}) {
  const record = { id: item.id, manifest: item.manifest };
  const name = pluginName(record);
  const installs = installsText(item, t);
  return (
    <div className="plugin-page market-plugin-page" data-market-page={item.id}>
      <button type="button" className="plugin-back" onClick={onBack}>
        ‹ {t.pluginBackToList}
      </button>
      <div className="market-plugin-head">
        <PluginIcon
          id={item.id}
          manifest={item.manifest}
          url={item.icon}
          large
        />
        <div className="market-plugin-title">
          <h2 className="plugin-page-title">{name}</h2>
          <div className="settings-row-hint">
            {pluginText(record, item.manifest.description)}
          </div>
          <Byline manifest={item.manifest} official={item.official} t={t}>
            {installs && <span className="plugin-installs">{installs}</span>}
            {item.updated && (
              <span>{t.pluginUpdatedOn.replace("{date}", item.updated)}</span>
            )}
          </Byline>
        </div>
        {action}
      </div>
      {item.screenshots.length > 0 && (
        <div className="market-plugin-shots">
          {item.screenshots.map((shot) => (
            <img
              key={shot}
              className="plugin-card-shot"
              src={shot}
              alt={t.pluginScreenshot.replace("{name}", name)}
              loading="lazy"
            />
          ))}
        </div>
      )}
      {item.hasReadme && (
        <PluginReadme
          id={item.id}
          installed={installed}
          label={t.pluginReadmeLabel.replace("{name}", name)}
        />
      )}
      <SettingsGroup title={t.pluginPermissionsLabel}>
        {item.manifest.permissions.length ? (
          item.manifest.permissions.map((p) => (
            <SettingRow key={p} label={permissionLabel(p, t)} />
          ))
        ) : (
          <SettingRow label={t.pluginNoPermissions} />
        )}
      </SettingsGroup>
    </div>
  );
}
