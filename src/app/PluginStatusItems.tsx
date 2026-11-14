import { useMenuButton } from "../engine/controls/useMenuButton";
import { Fragment, useMemo, useSyncExternalStore } from "react";
import { Tooltip } from "../engine/controls/Tooltip";
import { ChevronIcon } from "../engine/controls/icons";
import { runCommand } from "../registry/commands";
import {
  statusItemsSnapshot,
  subscribeStatusItems,
  withDeclared,
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
  windowInfo,
} from "../plugins/store/plugin-records";
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
    () =>
      groupStatusItems(
        withDeclared(items, plugins, windowInfo().language()),
        pluginMenuEntries(plugins),
      ),
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
      className="tx-truncate plugin-status-item plugin-status-button"
      data-status={item.key}
      onClick={() => runCommand(item.command!)}
    >
      {item.text}
    </button>
  ) : (
    <span className="tx-truncate plugin-status-item" data-status={item.key}>
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
  const { button, menu } = useMenuButton(
    () => [
      ...group.items.map((item) => ({
        label: item.text,
        disabled: !item.command,
        onSelect: () => item.command && runCommand(item.command),
      })),
      ...(group.commands.length ? (["separator"] as const) : []),
      ...group.commands.map((entry) => ({
        label: entry.label,
        onSelect: () => runCommand(entry.command),
      })),
    ],
    { title: name, alignEnd: true },
  );
  return (
    <div className="plugin-status-group">
      <Tooltip text={name}>
        <button
          type="button"
          className="tx-truncate plugin-status-item plugin-status-button"
          data-status-plugin={group.plugin}
          {...button}
        >
          {group.items[0].text}
          <ChevronIcon className="plugin-status-more" />
        </button>
      </Tooltip>
      {menu}
    </div>
  );
}
