import { ChevronDownIcon } from "../../engine/controls/icons";
import { fill } from "../../i18n/fill";
import { useMenuButton } from "../../engine/controls/useMenuButton";
import { useSyncExternalStore } from "react";
import type { Strings } from "../../i18n/strings";
import {
  pluginName,
  pluginsSnapshot,
  subscribePlugins,
  type PluginRecord,
} from "../../plugins/store/plugin-records";
import {
  catalogSnapshot,
  subscribeCatalog,
  updateFor,
  neededTextus,
  catalogItem,
} from "../../plugins/store/catalog";
import { canSwitch } from "../../plugins/store/lifecycle";
import { usePluginInstall } from "./usePluginInstall";

/** The plugin actions, and `actionFor(id)`: plugin `id`'s button, from
 *  what is installed and what the catalog offers now. */
export function usePluginActions(t: Strings) {
  const plugins = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  const catalog = useSyncExternalStore(subscribeCatalog, catalogSnapshot);
  const actions = usePluginInstall(t);
  const { installing, install, enable, uninstall } = actions;
  const actionFor = (id: string) => {
    const record = plugins.records.find((r) => r.id === id);
    const item = catalogItem(id, catalog);
    return (
      <PluginAction
        t={t}
        name={pluginName(record ?? { id, manifest: item?.manifest ?? null })}
        record={record}
        update={record ? updateFor(id, catalog) : null}
        needs={item ? neededTextus(item) : null}
        installing={installing === id}
        onInstall={() => item && void install(item)}
        onUpdate={() => item && void install(item)}
        onEnable={(on) => record && void enable(record, on)}
        onUninstall={() => record && void uninstall(record)}
      />
    );
  };
  return { ...actions, actionFor };
}

interface Action {
  label: string;
  run: () => void;
  danger?: boolean;
  /** Shown, not pressable. */
  unavailable?: boolean;
}

/**
 * A plugin's one button and the menu beside it, the same in Get more and
 * in the installed list: Install; once installed, Update when there is
 * one, else Turn Off or Turn On; the rest, and Uninstall, in the menu.
 */
function PluginAction({
  t,
  name,
  record,
  update,
  needs,
  installing,
  onInstall,
  onUpdate,
  onEnable,
  onUninstall,
}: {
  t: Strings;
  name: string;
  /** Installed, its record; undefined while it is only in the catalog. */
  record: PluginRecord | undefined;
  /** The catalog's newer version, if there is one. */
  update: string | null;
  /** The newer Textus the catalog's version needs, if it doesn't run here. */
  needs: string | null;
  installing: boolean;
  onInstall: () => void;
  onUpdate: () => void;
  onEnable: (on: boolean) => void;
  onUninstall: () => void;
}) {
  let main: Action;
  const menu: Action[] = [];
  if (!record && needs) {
    main = {
      label: fill(t.pluginNeedsTextus, { version: needs }),
      run: () => {},
      unavailable: true,
    };
  } else if (!record) {
    main = {
      label: installing ? t.pluginInstalling : t.pluginInstall,
      run: onInstall,
    };
  } else {
    const on = record.status === "on";
    const toggle =
      record.manifest && canSwitch(record.status)
        ? {
            label: on ? t.pluginTurnOff : t.pluginTurnOn,
            run: () => onEnable(!on),
          }
        : null;
    const uninstall = {
      label: record.origin === "dev" ? t.pluginUnload : t.pluginUninstall,
      run: onUninstall,
      danger: true,
    };
    if (update) {
      main = {
        label: installing
          ? t.pluginInstalling
          : fill(t.pluginUpdate, { version: update }),
        run: onUpdate,
      };
      if (toggle) menu.push(toggle);
    } else main = toggle ?? uninstall;
    if (main !== uninstall) menu.push(uninstall);
  }
  const more = useMenuButton(
    () =>
      menu.map((a) => ({ label: a.label, danger: a.danger, onSelect: a.run })),
    { alignEnd: true },
  );
  return (
    <div className="plugin-action">
      <button
        type="button"
        className={`text-button plugin-action-main${menu.length ? " is-split" : ""}${main.danger ? " danger" : ""}`}
        disabled={installing || main.unavailable}
        onClick={main.run}
      >
        {main.label}
      </button>
      {menu.length > 0 && (
        <button
          type="button"
          className="text-button plugin-action-more"
          aria-label={fill(t.pluginMoreFor, { name })}
          disabled={installing}
          {...more.button}
        >
          <ChevronDownIcon />
        </button>
      )}
      {more.menu}
    </div>
  );
}
