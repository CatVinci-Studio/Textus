import { Fragment, useMemo, useState, useSyncExternalStore } from "react";
import { Tooltip } from "../ui/Tooltip";
import { ChevronIcon } from "../ui/icons";
import { useCloseOnOutsideClick } from "../utils/hooks/useCloseOnOutsideClick";
import { runCommand } from "./commands";
import {
  statusItemsSnapshot,
  subscribeStatusItems,
  type StatusItem,
} from "../plugins/contributions/status-items";
import {
  groupStatusItems,
  type StatusGroup,
} from "../plugins/contributions/status-groups";
import {
  pluginName,
  pluginsSnapshot,
  subscribePlugins,
} from "../plugins/manager";
import { pluginMenuEntries } from "../plugins/store/plugin-lookup";

/**
 * What plugins show in the window bar, one place per plugin: a plugin with
 * a single item and nothing else to offer shows it as it is; one with more -
 * several items, or commands of its own - shows its first, and a click
 * opens all of them with its commands, under its name.
 */
export function PluginStatusItems() {
  const items = useSyncExternalStore(subscribeStatusItems, statusItemsSnapshot);
  const plugins = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  const groups = useMemo(
    () => groupStatusItems(items, pluginMenuEntries(plugins)),
    [items, plugins],
  );
  return (
    <>
      {groups.map((group) =>
        group.items.length === 1 && group.commands.length === 0 ? (
          <StatusEntry key={group.plugin} item={group.items[0]} />
        ) : (
          <StatusGroupButton
            key={group.plugin}
            group={group}
            name={nameOf(group.plugin, plugins.records)}
          />
        ),
      )}
    </>
  );
}

function nameOf(
  id: string,
  records: ReturnType<typeof pluginsSnapshot>["records"],
): string {
  const record = records.find((r) => r.id === id);
  return record ? pluginName(record) : id;
}

/** One item alone: a text, its tooltip, and a command a click runs. */
function StatusEntry({ item }: { item: StatusItem }) {
  const shown = item.command ? (
    <button
      type="button"
      className="plugin-status-item plugin-status-button"
      data-status={item.key}
      onClick={() => runCommand(item.command!)}
    >
      {item.text}
    </button>
  ) : (
    <span className="plugin-status-item" data-status={item.key}>
      {item.text}
    </span>
  );
  return item.tooltip ? (
    <Tooltip text={item.tooltip}>{shown}</Tooltip>
  ) : (
    <Fragment>{shown}</Fragment>
  );
}

function StatusGroupButton({
  group,
  name,
}: {
  group: StatusGroup;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useCloseOnOutsideClick<HTMLDivElement>(
    () => setOpen(false),
    true,
    open,
  );
  const run = (command: string) => {
    setOpen(false);
    runCommand(command);
  };
  return (
    <div className="plugin-status-group" ref={ref}>
      <Tooltip text={name}>
        <button
          type="button"
          className="plugin-status-item plugin-status-button"
          data-status-plugin={group.plugin}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {group.items[0].text}
          <ChevronIcon className="plugin-status-more" />
        </button>
      </Tooltip>
      {open && (
        <div
          className="plugin-status-menu floating-surface"
          role="menu"
          aria-label={name}
        >
          <div className="plugin-status-menu-title">{name}</div>
          {group.items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="context-menu-item"
              data-status={item.key}
              title={item.tooltip}
              disabled={!item.command}
              onClick={() => item.command && run(item.command)}
            >
              {item.text}
            </button>
          ))}
          {group.commands.length > 0 && (
            <div className="plugin-status-menu-separator" role="separator" />
          )}
          {group.commands.map((entry) => (
            <button
              key={entry.command}
              type="button"
              role="menuitem"
              className="context-menu-item"
              onClick={() => run(entry.command)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
