import { useSyncExternalStore } from "react";
import { requestCreate } from "../../ai/chat/create-request";
import {
  pluginsSnapshot,
  subscribePlugins,
} from "../../plugins/store/plugin-records";
import {
  catalogSnapshot,
  subscribeCatalog,
  updateFor,
} from "../../plugins/store/catalog";
import type { Strings } from "../../i18n/strings";
import { MarketPluginPage } from "./MarketPluginPage";
import { usePluginActions } from "./PluginAction";
import { PluginPage } from "./PluginPage";
import { editRequest } from "./PluginsPage";

/**
 * One plugin's page, by id: the installed plugin's (its README, version,
 * permissions, settings, data), else the catalog's for one not installed
 * (installed from there, it goes on as the installed one's). Null for an
 * id that is neither.
 */
export function PluginDetail({
  id,
  t,
  onBack,
}: {
  id: string;
  t: Strings;
  onBack?: () => void;
}) {
  const snapshot = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot);
  const { installing, install, enable, attempt, actionFor } =
    usePluginActions(t);
  const record = snapshot.records.find((r) => r.id === id);
  const item =
    catalog.status === "ready"
      ? catalog.items.find((i) => i.id === id)
      : undefined;
  if (record)
    return (
      <PluginPage
        record={record}
        t={t}
        allOn={snapshot.allOn}
        update={updateFor(record.id, catalog)}
        installing={installing === record.id}
        onBack={onBack}
        onEditWithAi={() => requestCreate(editRequest(record, t))}
        onEnable={(on) => void enable(record, on)}
        onUpdate={() => item && void install(item)}
        attempt={attempt}
      />
    );
  if (item)
    return (
      <MarketPluginPage
        item={item}
        t={t}
        installed={false}
        action={actionFor(item.id)}
        onBack={onBack}
      />
    );
  return null;
}
