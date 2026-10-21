import { useEffect, useMemo, useRef, useState } from "react";
import { useModalDialog } from "../ui/useModalDialog";

/**
 * textus.window.showQuickPick: a list to choose one item from, filtered by
 * what is typed - the one place a plugin asks for a choice without a
 * webview of its own. Shown by the QuickPickHost App mounts; requests
 * queue, as app-dialog's do.
 */
export interface QuickPickItem {
  label: string;
  description?: string;
  /** What the plugin gets back; the label if left out. */
  value?: unknown;
}

interface Request {
  id: number;
  items: QuickPickItem[];
  placeholder: string;
  resolve: (value: unknown) => void;
}

let nextId = 1;
let queue: Request[] = [];
const listeners = new Set<(queue: Request[]) => void>();

function publish() {
  for (const listener of listeners) listener(queue);
}

/** Resolves the chosen item's value, or null when dismissed. */
export function showQuickPick(
  items: QuickPickItem[],
  placeholder: string,
): Promise<unknown> {
  return new Promise((resolve) => {
    queue = [...queue, { id: nextId++, items, placeholder, resolve }];
    publish();
  });
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

export function QuickPickHost({ emptyLabel }: { emptyLabel: string }) {
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
    <QuickPick key={current.id} request={current} emptyLabel={emptyLabel} />
  );
}

function QuickPick({
  request,
  emptyLabel,
}: {
  request: Request;
  emptyLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const shown = useMemo(
    () => request.items.filter((item) => quickPickMatches(item, query)),
    [request.items, query],
  );
  const dialog = useModalDialog(
    () => answer(request, null),
    true,
    ".quick-pick-input",
  );
  const choose = (item: QuickPickItem | undefined) => {
    if (item)
      answer(request, item.value === undefined ? item.label : item.value);
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
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(shown[index]);
            }
          }}
        />
        <ul
          className="quick-pick-list"
          id="quick-pick-list"
          role="listbox"
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
              aria-selected={i === index}
              className="quick-pick-item"
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(item)}
            >
              <span className="quick-pick-label">{item.label}</span>
              {item.description && (
                <span className="quick-pick-description">
                  {item.description}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
