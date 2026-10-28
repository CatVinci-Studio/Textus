import { useState, useSyncExternalStore } from "react";
import type { Strings } from "../../i18n/strings";
import {
  pluginName,
  pluginsSnapshot,
  subscribePlugins,
  type PluginRecord,
} from "../../plugins/manager";
import {
  catalogSnapshot,
  subscribeCatalog,
  updateFor,
} from "../../plugins/store/catalog";
import { canSwitch } from "../../plugins/store/lifecycle";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";
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
    const item =
      catalog.status === "ready"
        ? catalog.items.find((i) => i.id === id)
        : undefined;
    return (
      <PluginAction
        t={t}
        name={pluginName(record ?? { id, manifest: item?.manifest ?? null })}
        record={record}
        update={record ? updateFor(id, catalog) : null}
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
}

/**
 * A plugin's one button and the menu beside it, the same in Get more and
 * in the installed list: Install; once installed, Update when there is
 * one, else Turn Off or Turn On; the rest, and Uninstall, in the menu.
 */
export function PluginAction({
  t,
  name,
  record,
  update,
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
  installing: boolean;
  onInstall: () => void;
  onUpdate: () => void;
  onEnable: (on: boolean) => void;
  onUninstall: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useCloseOnOutsideClick<HTMLDivElement>(
    () => setOpen(false),
    true,
    open,
  );
  let main: Action;
  const menu: Action[] = [];
  if (!record) {
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
          : t.pluginUpdate.replace("{version}", update),
        run: onUpdate,
      };
      if (toggle) menu.push(toggle);
    } else main = toggle ?? uninstall;
    if (main !== uninstall) menu.push(uninstall);
  }
  return (
    <div className="plugin-action" ref={ref}>
      <button
        type="button"
        className={`text-button plugin-action-main${menu.length ? " is-split" : ""}${main.danger ? " danger" : ""}`}
        disabled={installing}
        onClick={main.run}
      >
        {main.label}
      </button>
      {menu.length > 0 && (
        <button
          type="button"
          className="text-button plugin-action-more"
          aria-label={t.pluginMoreFor.replace("{name}", name)}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={installing}
          onClick={() => setOpen((v) => !v)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      )}
      {open && (
        <div className="extensions-more-menu floating-surface" role="menu">
          {menu.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className={`context-menu-item${action.danger ? " danger" : ""}`}
              onClick={() => {
                setOpen(false);
                action.run();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
