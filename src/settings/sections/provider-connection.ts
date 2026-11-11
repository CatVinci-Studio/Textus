import { useMemo, useState } from "react";
import type { Strings } from "../../i18n/strings";
import type { ProviderCatalogEntry } from "../../ai/provider-catalog";
import {
  localizedLabel,
  useConnectedProviders,
} from "../../ai/provider-connection";
import type { AiProvider } from "../../prefs/SettingsContext";
import { useSettingsIndexing } from "../indexing";

/** The providers' connections as Settings shows them: not checked while
 *  Settings is only drawn for its search. */
export function useSettingsConnected(
  catalog: ProviderCatalogEntry[],
  activeId: AiProvider,
  onActiveConnectedChange?: (connected: boolean) => void,
) {
  const indexing = useSettingsIndexing();
  return useConnectedProviders(
    catalog,
    activeId,
    onActiveConnectedChange,
    !indexing,
  );
}

/** The provider list's search: the query typed and the providers whose
 *  name (as shown) or id holds it. */
export function useProviderSearch(catalog: ProviderCatalogEntry[], t: Strings) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (e) => localizedLabel(e, t).toLowerCase().includes(q) || e.id.includes(q),
    );
  }, [catalog, query, t]);
  return { query, setQuery, filtered };
}
