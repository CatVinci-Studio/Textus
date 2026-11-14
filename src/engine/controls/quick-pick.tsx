import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  answer,
  quickPickNow,
  subscribeQuickPick,
  valueOf,
  type QuickPickItem,
  type Request,
} from "./quick-pick-queue";
import { formatCombo } from "../../utils/shortcuts";
import { useModalDialog } from "./useModalDialog";
import "./quick-pick.css";
import { isImeKeydown } from "../../utils/ime";
import { listMove } from "./list-keys";
import { useShownItems } from "./quick-pick-shown";

export function QuickPickHost({
  emptyLabel,
  okLabel,
}: {
  emptyLabel: string;
  okLabel: string;
}) {
  const current = useSyncExternalStore(subscribeQuickPick, quickPickNow);
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
  const shown = useShownItems(request, query);
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
  const done = () => answer(request, [...ticked].map(valueOf));
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
      className="tx-backdrop quick-pick-overlay"
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
            const moved = listMove(e.key, index, shown.length, false);
            if (moved !== null) {
              e.preventDefault();
              setIndex(moved);
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
          {shown.length === 0 && <li className="tx-list-note">{emptyLabel}</li>}
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
                  className="ui-check"
                  tabIndex={-1}
                  aria-hidden="true"
                  checked={ticked.has(item)}
                  readOnly
                />
              )}
              <span className="quick-pick-label">{item.label}</span>
              {item.description && (
                <span className="tx-truncate quick-pick-description">
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
