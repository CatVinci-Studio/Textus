import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ContextMenu } from "../../editor/ContextMenu";
import { useLatest } from "../../utils/hooks/useLatest";
import { runCommand } from "../../app/commands";
import {
  BulletListIcon,
  CheckIcon,
  ChevronIcon,
  FolderIcon,
  GenericFileIcon,
  HistoryIcon,
  ImageFileIcon,
  PinIcon,
  SearchIcon,
} from "../../ui/icons";
import { getWindowAccess } from "../app-bridge";
import { askPlugin, pluginRecord } from "../manager";
import {
  listView,
  listViewsVersion,
  subscribeListViews,
} from "../contributions/list-views";
import { windowInfo } from "../store/plugin-records";
import "./PluginListView.css";

/** A list item as a plugin gives it. */
export interface PluginListItem {
  id?: string;
  label: string;
  description?: string;
  detail?: string;
  group?: string;
  icon?: string;
  checkbox?: boolean;
  badge?: { text: string; tone?: "accent" | "warning" | "danger" | "muted" };
  location?: {
    path: string;
    line?: number;
    heading?: string;
    block?: string;
    text?: string;
    page?: number;
  };
  command?: { id: string; args?: unknown[] };
  children?: boolean;
  actions?: { label: string; command: string; args?: unknown[] }[];
  data?: unknown;
}

const ICONS: Record<string, (props: { className?: string }) => ReactNode> = {
  file: GenericFileIcon,
  folder: FolderIcon,
  image: ImageFileIcon,
  task: CheckIcon,
  history: HistoryIcon,
  pin: PinIcon,
  search: SearchIcon,
  list: BulletListIcon,
};

/** Whether every word typed is in the item's words. */
export function listItemMatches(item: PluginListItem, query: string): boolean {
  const haystack =
    `${item.label} ${item.description ?? ""} ${item.detail ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function keyOf(item: PluginListItem, index: number): string {
  return item.id ?? `${index}:${item.label}`;
}

/** What a click on an item does when the plugin doesn't take it: its
 *  place opens, or its command runs. */
function defaultSelect(item: PluginListItem) {
  if (item.location) {
    const { path, ...place } = item.location;
    getWindowAccess()?.openFile(path, { place, where: "tab" });
  } else if (item.command) runCommand(item.command.id, item.command.args ?? []);
}

/**
 * A plugin's list, drawn by Textus in a sidebar tab or a tab of its own: the
 * plugin gives the items, Textus the look, keys, filter and folding.
 */
export function PluginListPane({
  plugin,
  view,
  className,
}: {
  plugin: string;
  view: string;
  className?: string;
}) {
  const { info, items, setItems, children, open, toggleOpen, error } =
    usePluginListItems(plugin, view);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    item: PluginListItem;
  } | null>(null);
  const t = windowInfo().strings();

  const select = (item: PluginListItem) => {
    if (info?.select)
      void askPlugin(plugin, "$listSelect", { view, item }).catch(() => {});
    else defaultSelect(item);
  };

  const check = (item: PluginListItem) => {
    // Ticked at once; the plugin's refresh has the last word.
    setItems(
      (all) =>
        all?.map((i) => (i === item ? { ...i, checkbox: !i.checkbox } : i)) ??
        all,
    );
    void askPlugin(plugin, "$listCheck", {
      view,
      item,
      checked: !item.checkbox,
    }).catch(() => {});
  };

  // The rows as shown: filtered, open items' children under them.
  const rows = useMemo(() => {
    const out: { item: PluginListItem; key: string; depth: number }[] = [];
    const walk = (list: PluginListItem[], depth: number, prefix: string) =>
      list.forEach((item, i) => {
        const key = `${prefix}${keyOf(item, i)}`;
        if (!query || listItemMatches(item, query))
          out.push({ item, key, depth });
        if (item.children && open.has(key))
          walk(children.get(key) ?? [], depth + 1, `${key}/`);
      });
    walk(items ?? [], 0, "");
    return out;
  }, [items, children, open, query]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || !rows.length) return;
    const row = rows[Math.min(active, rows.length - 1)];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(row.item);
    } else if (e.key === " " && row.item.checkbox !== undefined) {
      e.preventDefault();
      check(row.item);
    } else if (
      (e.key === "ArrowRight" && !open.has(row.key)) ||
      (e.key === "ArrowLeft" && open.has(row.key))
    ) {
      if (!row.item.children) return;
      e.preventDefault();
      toggleOpen(row.item, row.key);
    }
  };

  const name = pluginRecord(plugin)?.manifest?.name ?? plugin;
  let lastGroup: string | undefined;
  return (
    <div className={`plugin-list ${className ?? ""}`}>
      {info?.filterPlaceholder !== undefined && (
        <input
          className="plugin-list-filter settings-text-input"
          placeholder={info.filterPlaceholder}
          aria-label={info.filterPlaceholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
        />
      )}
      {info?.message && (
        <div className="plugin-list-message">{info.message}</div>
      )}
      {error && <div className="plugin-webview-problem">{error}</div>}
      <div
        className="plugin-list-rows"
        role="tree"
        aria-label={name}
        tabIndex={0}
        onKeyDown={onKey}
      >
        {items && rows.length === 0 && (
          <div className="plugin-list-empty">
            {query ? t.pluginQuickPickEmpty : (info?.emptyText ?? "")}
          </div>
        )}
        {rows.map(({ item, key, depth }, index) => {
          const heading =
            depth === 0 && item.group && item.group !== lastGroup
              ? item.group
              : null;
          if (depth === 0) lastGroup = item.group;
          const Icon = item.icon ? ICONS[item.icon] : undefined;
          return (
            // The row's place too: two items a plugin gave one id still draw.
            <div key={`${key}@${index}`} className="plugin-list-entry">
              {heading && <div className="plugin-list-group">{heading}</div>}
              <div
                role="treeitem"
                aria-level={depth + 1}
                aria-expanded={item.children ? open.has(key) : undefined}
                aria-selected={index === active}
                className={`plugin-list-row${index === active ? " is-active" : ""}${
                  item.checkbox ? " is-done" : ""
                }`}
                style={{ paddingInlineStart: `${8 + depth * 14}px` }}
                onMouseEnter={() => setActive(index)}
                onClick={() => select(item)}
                onContextMenu={(e) => {
                  if (!item.actions?.length) return;
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, item });
                }}
              >
                {item.children ? (
                  <button
                    type="button"
                    className="plugin-list-twisty"
                    aria-label={item.label}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleOpen(item, key);
                    }}
                  >
                    <ChevronIcon
                      className={open.has(key) ? "is-open" : undefined}
                    />
                  </button>
                ) : (
                  <span className="plugin-list-twisty" aria-hidden="true" />
                )}
                {item.checkbox !== undefined && (
                  <input
                    type="checkbox"
                    className="plugin-list-check"
                    checked={item.checkbox}
                    aria-label={item.label}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => check(item)}
                  />
                )}
                {Icon && <Icon className="plugin-list-icon" />}
                <span className="plugin-list-text">
                  <span className="plugin-list-label">{item.label}</span>
                  {item.description && (
                    <span className="plugin-list-description">
                      {item.description}
                    </span>
                  )}
                  {item.detail && (
                    <span className="plugin-list-detail">{item.detail}</span>
                  )}
                </span>
                {item.badge && (
                  <span
                    className="plugin-list-badge"
                    data-tone={item.badge.tone ?? "muted"}
                  >
                    {item.badge.text}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={menu.item.label}
          onClose={() => setMenu(null)}
          items={(menu.item.actions ?? []).map((action) => ({
            label: action.label,
            onSelect: () => {
              setMenu(null);
              runCommand(action.command, [
                ...(action.args ?? []),
                menu.item.data ?? null,
              ]);
            },
          }))}
        />
      )}
    </div>
  );
}

/**
 * A plugin list's items, asked when the list shows and on each refresh, with
 * the open items' children; the plugin is started first if needed.
 */
function usePluginListItems(plugin: string, view: string) {
  useSyncExternalStore(subscribeListViews, listViewsVersion);
  const info = listView(plugin, view);
  const [items, setItems] = useState<PluginListItem[] | null>(null);
  const [children, setChildren] = useState<Map<string, PluginListItem[]>>(
    () => new Map(),
  );
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(
    (parent?: PluginListItem) =>
      askPlugin(plugin, "$listItems", { view, parent: parent ?? null }).then(
        (answer) => (Array.isArray(answer) ? (answer as PluginListItem[]) : []),
      ),
    [plugin, view],
  );

  // Started on first show: the plugin registers its list as it activates.
  useEffect(() => {
    if (info) return;
    askPlugin(plugin, "$ping", {}).catch((err) =>
      setError(String((err as Error)?.message ?? err)),
    );
  }, [plugin, info]);

  // Read as they are when the list refreshes, not a reason to refresh.
  const state = useLatest({ open, items, children });
  const version = info?.version ?? 0;
  useEffect(() => {
    if (!version) return;
    let live = true;
    ask()
      .then((got) => {
        if (!live) return;
        setItems(got);
        setError(null);
      })
      .catch((err) => live && setError(String((err as Error)?.message ?? err)));
    // An open item's children are asked again too.
    const now = state.current;
    for (const id of now.open) {
      const parent = findItem(now.items ?? [], now.children, id);
      void ask(parent ?? undefined)
        .then((got) => live && setChildren((m) => new Map(m).set(id, got)))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [ask, version, state]);

  const toggleOpen = (item: PluginListItem, key: string) => {
    const next = new Set(open);
    if (next.delete(key)) {
      setOpen(next);
      return;
    }
    next.add(key);
    setOpen(next);
    void ask(item)
      .then((got) => setChildren((m) => new Map(m).set(key, got)))
      .catch(() => {});
  };

  return { info, items, setItems, children, open, toggleOpen, error };
}

function findItem(
  top: PluginListItem[],
  children: Map<string, PluginListItem[]>,
  key: string,
): PluginListItem | null {
  const parts = key.split("/");
  let list = top;
  let prefix = "";
  let found: PluginListItem | null = null;
  for (const part of parts) {
    const index = list.findIndex((item, i) => keyOf(item, i) === part);
    if (index < 0) return null;
    found = list[index];
    prefix = prefix ? `${prefix}/${part}` : part;
    list = children.get(prefix) ?? [];
  }
  return found;
}
