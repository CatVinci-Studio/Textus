import { MarketPage } from "./MarketPage";
import { fill } from "../../i18n/fill";
import { Byline } from "./CatalogRow";
import { PluginIcon, PluginReadme } from "./PluginArt";
import type { ReactNode } from "react";
import { installsText } from "./installs-text";
import { SettingsGroup } from "./SettingsGroup";
import { SettingRow } from "../sections/controls";
import type { Strings } from "../../i18n/strings";
import { pluginName, pluginText } from "../../plugins/store/plugin-records";
import {
  permissionLabel,
  shownPermissions,
} from "../../plugins/store/permissions";
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
  /** Back to a list it was opened from; none in a tab of its own. */
  onBack?: () => void;
}) {
  const record = { id: item.id, manifest: item.manifest };
  const name = pluginName(record);
  const installs = installsText(item, t);
  return (
    <MarketPage
      data={{ "data-market-page": item.id }}
      backLabel={t.pluginBackToList}
      onBack={onBack}
      mark={
        <PluginIcon
          id={item.id}
          manifest={item.manifest}
          url={item.icon}
          large
        />
      }
      name={name}
      description={pluginText(record, item.manifest.description)}
      byline={
        <Byline
          t={t}
          official={item.official}
          author={item.manifest.author || item.manifest.publisher}
          version={item.manifest.version}
          installs={installs}
        >
          {item.updated && (
            <span>{fill(t.pluginUpdatedOn, { date: item.updated })}</span>
          )}
        </Byline>
      }
      action={action}
    >
      {item.screenshots.length > 0 && (
        <div className="market-plugin-shots">
          {item.screenshots.map((shot) => (
            <img
              key={shot}
              className="plugin-card-shot"
              src={shot}
              alt={fill(t.pluginScreenshot, { name })}
              loading="lazy"
            />
          ))}
        </div>
      )}
      {item.hasReadme && (
        <PluginReadme
          id={item.id}
          installed={installed}
          label={fill(t.pluginReadmeLabel, { name })}
        />
      )}
      <SettingsGroup title={t.pluginPermissionsLabel}>
        {shownPermissions(item.manifest.permissions).length ? (
          shownPermissions(item.manifest.permissions).map((p) => (
            <SettingRow key={p} label={permissionLabel(p, t)} />
          ))
        ) : (
          <SettingRow label={t.pluginNoPermissions} />
        )}
      </SettingsGroup>
    </MarketPage>
  );
}
