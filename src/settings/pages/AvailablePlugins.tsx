import { explainError } from "../../utils/error-explain";
import { fill } from "../../i18n/fill";
import { useState, type ReactNode } from "react";
import { Byline, CatalogRow, DesktopOnlyMark, headedRows } from "./CatalogRow";
import { CatalogProblem, catalogMessage, catalogStatus } from "./CatalogStatus";
import { PluginIcon } from "./PluginArt";
import type { Strings } from "../../i18n/strings";
import { pluginName, pluginText } from "../../plugins/store/plugin-records";
import {
  searchCatalog,
  sortCatalog,
  type CatalogItem,
  type CatalogSort,
  type CatalogState,
  offeredItems,
} from "../../plugins/store/catalog";
import { Select } from "../../engine/controls/Select";
import { AvailableSection } from "./AvailableSection";
import { installsText } from "./installs-text";
import { desktopOnly } from "../../plugins/plugin-platform";
import { byCategory } from "../../plugins/store/plugin-categories";

const SORTS: CatalogSort[] = ["popular", "newest", "name"];

/** The catalog's plugins not installed yet, by category with the most
 *  installed first in each, or in one list by date or name (a search keeps
 *  the categories); each opens its page. */
export function AvailablePlugins({
  t,
  catalog,
  query,
  installed,
  actionFor,
  onOpen,
}: {
  t: Strings;
  catalog: CatalogState;
  query: string;
  installed: ReadonlySet<string>;
  /** A plugin's button (PluginAction). */
  actionFor: (id: string) => ReactNode;
  onOpen: (item: CatalogItem) => void;
}) {
  const [sort, setSort] = useState<CatalogSort>("popular");
  const sortLabel: Record<CatalogSort, string> = {
    popular: t.pluginsSortPopular,
    newest: t.pluginsSortNewest,
    name: t.pluginsSortName,
  };
  const ready = catalog.status === "ready";
  const offered = ready
    ? offeredItems(
        sortCatalog(searchCatalog(catalog.items, query), sort),
        installed,
      )
    : [];
  const shown =
    sort === "popular" || query.trim()
      ? byCategory(offered, t)
      : offered.map((item) => ({ item }));
  const message = catalogMessage({
    t,
    status: catalogStatus(catalog),
    error: catalog.status === "failed" ? catalog.error : undefined,
    query,
    shown: shown.length,
  });
  return (
    <AvailableSection
      t={t}
      kind="plugins"
      searching={!!query.trim()}
      message={message}
      head={
        <div className="market-sort">
          <Select
            className="inline-chat-mode"
            aria-label={t.pluginsSortLabel}
            value={sort}
            onChange={(e) => setSort(e.target.value as CatalogSort)}
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {sortLabel[s]}
              </option>
            ))}
          </Select>
        </div>
      }
      note={
        ready &&
        catalog.error && (
          <CatalogProblem
            t={t}
            text={fill(t.pluginsCatalogKept, {
              reason: explainError(catalog.error, t),
            })}
          />
        )
      }
      rows={headedRows(shown, "plugin-subgroup-title", (item) => (
        <CatalogCard
          item={item}
          t={t}
          action={actionFor(item.id)}
          onOpen={() => onOpen(item)}
        />
      ))}
    />
  );
}

/** A plugin the catalog offers: its icon, name, line and installs, opening
 *  its page; its button beside it. */
function CatalogCard({
  item,
  t,
  action,
  onOpen,
}: {
  item: CatalogItem;
  t: Strings;
  action: ReactNode;
  onOpen: () => void;
}) {
  const name = pluginName({ id: item.id, manifest: item.manifest });
  const installs = installsText(item, t);
  return (
    <CatalogRow
      data-catalog={item.id}
      name={name}
      description={pluginText(
        { manifest: item.manifest },
        item.manifest.description,
      )}
      icon={
        <PluginIcon id={item.id} manifest={item.manifest} url={item.icon} />
      }
      byline={
        <Byline
          t={t}
          official={item.official}
          author={item.manifest.author || item.manifest.publisher}
          version={item.manifest.version}
          installs={installs}
        >
          {desktopOnly(item.manifest) && <DesktopOnlyMark t={t} />}
        </Byline>
      }
      openLabel={fill(t.pluginOpenDetails, { name })}
      onOpen={onOpen}
      action={action}
    />
  );
}
