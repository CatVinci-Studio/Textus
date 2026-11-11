import type { ProviderCatalogEntry } from "../../ai/provider-catalog";
import { useConnectedProviders } from "../../ai/provider-connection";
import type { AiProvider } from "../../prefs/SettingsContext";
import { useSettingsIndexing } from "../indexing";

/** The providers' connections as Settings shows them: not checked while
 *  Settings is only drawn for its search. */
export function useSettingsConnected(
  catalog: readonly ProviderCatalogEntry[],
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
