import { useEffect, useMemo, useRef, useState } from "react";
import { formatCombo } from "../utils/shortcuts";
import { useModalDialog } from "./useModalDialog";
import "./quick-pick.css";
import { isImeKeydown } from "../utils/ime";

/** A list to choose one item from, or several ticked, filtered by what is
 *  typed: the command palette's and a plugin's textus.ui.pick. Requests queue. */
export interface QuickPickItem {
  label: string;
  description?: string;
  /** A second line under it. */
  detail?: string;
  /** What the plugin gets back; the label if left out. */
  value?: unknown;
  /** With `multiple`: ticked to start with. */
  picked?: boolean;
  /** A shortcut that does the same, shown at the row's end ("mod+s"). */
  keys?: string;
}

interface Request {
  id: number;
  items: QuickPickItem[];
  placeholder: string;
  multiple: boolean;
  /** The text in the box to start with; what follows it filters too. */
  query: string;
  /** Enter on text that matches nothing resolves { typed: text }. */
  typed: boolean;
  resolve: (value: unknown) => void;
}

let nextId = 1;
let queue: Request[] = [];
const listeners = new Set<(queue: Request[]) => void>();

function publish() {
  for (const listener of listeners) listener(queue);
}

/** Resolves the chosen item's value - with `multiple`, the ticked ones'
 *  values - or null when dismissed. */
export function showQuickPick(
  items: QuickPickItem[],
  placeholder: string,
  options: { multiple?: boolean; query?: string; typed?: boolean } = {},
): Promise<unknown> {
  return new Promise((resolve) => {
    queue = [
      ...queue,
      {
        id: nextId++,
        items,
        placeholder,
        multiple: options.multiple === true,
        query: options.query ?? "",
        typed: options.typed === true,
        resolve,
      },
    ];
    publish();
  });
}

function valueOf(item: QuickPickItem): unknown {
  return item.value === undefined ? item.label : item.value;
}

function answer(request: Request, value: unknown) {
  queue = queue.filter((r) => r.id !== request.id);
  publish();
  request.resolve(value);
}

/** Whether every word typed is in the item's label or description. */
export function quickPickMatches(item: QuickPickItem, query: string): boolean {
  const haystack = `${item.label} ${item.description ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function QuickPickHost({
  emptyLabel,
  okLabel,
}: {
  emptyLabel: string;
  okLabel: string;
}) {
  const [pending, setPending] = useState<Request[]>(queue);
  useEffect(() => {
    listeners.add(setPending);
    return () => {
      listeners.delete(setPending);
    };
  }, []);
  const current = pending[0];
  if (!current) return null;
  return (
    <QuickPick
      key={current.id}
      request={current}
      emptyLabel={emptyLabel}
      okLabel={okLabel}
    />
  );
}

function QuickPick({
  request,
  emptyLabel,
  okLabel,
}: {
  request: Request;
  emptyLabel: string;
  okLabel: string;
}) {
  const [query, setQuery] = useState(request.query);
  const [index, setIndex] = useState(0);
  const [ticked, setTicked] = useState(
    () => new Set(request.items.filter((i) => i.picked)),
  );
  const listRef = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => {
    // ":sa" finds Save as well as ":saveas"; ":12" is a line, not Heading
    // 1 or 2.
    const rest = query.startsWith(request.query)
      ? query.slice(request.query.length)
      : query;
    const words = /\p{L}/u.test(rest);
    return request.items.filter(
      (item) =>
        quickPickMatches(item, query) ||
        (words && quickPickMatches(item, rest)),
    );
  }, [request.items, request.query, query]);
  const dialog = useModalDialog(
    () => answer(request, null),
    true,
    ".quick-pick-input",
  );
  const toggle = (item: QuickPickItem) =>
    setTicked((now) => {
      const next = new Set(now);
      if (!next.delete(item)) next.add(item);
      return next;
    });
  const done = () =>
    answer(request, request.items.filter((i) => ticked.has(i)).map(valueOf));
  const choose = (item: QuickPickItem | undefined) => {
    if (!item) return;
    if (request.multiple) toggle(item);
    else answer(request, valueOf(item));
  };
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);
  return (
    <div
      className="close-prompt-overlay quick-pick-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) answer(request, null);
      }}
    >
      <div
        className="close-prompt quick-pick"
        {...dialog}
        role="dialog"
        aria-modal="true"
        aria-label={request.placeholder}
      >
        <input
          className="quick-pick-input"
          placeholder={request.placeholder}
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="quick-pick-list"
          aria-activedescendant={
            shown.length ? `quick-pick-${index}` : undefined
          }
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (isImeKeydown(e)) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (request.multiple) done();
              else if (shown[index]) choose(shown[index]);
              else if (request.typed && query.trim())
                answer(request, { typed: query.trim() });
            } else if (e.key === " " && request.multiple && !query) {
              e.preventDefault();
              choose(shown[index]);
            }
          }}
        />
        <ul
          className="quick-pick-list"
          id="quick-pick-list"
          role="listbox"
          aria-multiselectable={request.multiple || undefined}
          ref={listRef}
        >
          {shown.length === 0 && (
            <li className="quick-pick-empty">{emptyLabel}</li>
          )}
          {shown.map((item, i) => (
            <li
              key={`${i}-${item.label}`}
              id={`quick-pick-${i}`}
              data-index={i}
              role="option"
              aria-selected={request.multiple ? ticked.has(item) : i === index}
              className={`quick-pick-item${i === index ? " is-active" : ""}`}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(item)}
            >
              {request.multiple && (
                <input
                  type="checkbox"
                  tabIndex={-1}
                  aria-hidden="true"
                  checked={ticked.has(item)}
                  readOnly
                />
              )}
              <span className="quick-pick-label">{item.label}</span>
              {item.description && (
                <span className="quick-pick-description">
                  {item.description}
                </span>
              )}
              {item.keys && (
                <kbd className="quick-pick-keys">{formatCombo(item.keys)}</kbd>
              )}
              {item.detail && (
                <span className="quick-pick-detail">{item.detail}</span>
              )}
            </li>
          ))}
        </ul>
        {request.multiple && (
          <div className="close-prompt-buttons">
            <div className="close-prompt-spacer" />
            <button className="close-prompt-primary" onClick={done}>
              {okLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
