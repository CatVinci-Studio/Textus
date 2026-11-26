import { SelectMenu } from "./SelectMenu";
import {
  Children,
  Fragment,
  isValidElement,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { usePhoneLayout } from "./usePhoneLayout";
import { useDropdown } from "./useDropdown";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { Presence } from "../motion/usePresence";
import "./Select.css";

/** A drop-in for `<select>` whose list the app draws, in a portal marked
 *  `data-floating-select` so outside-click code treats it as inside its opener.
 *  On a phone it opens the app's menu (ContextMenu). */
interface OptionItem {
  value: string;
  label: ReactNode;
  disabled: boolean;
  /** The `<optgroup label>` it sits in, if any. */
  group?: string;
}

interface SelectProps {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  title?: string;
}

function collectOptions(
  children: ReactNode,
  out: OptionItem[] = [],
  group?: string,
) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<{
      value?: string;
      children?: ReactNode;
      disabled?: boolean;
      label?: string;
    }>;
    if (element.type === Fragment) {
      collectOptions(element.props.children, out, group);
    } else if (element.type === "optgroup") {
      collectOptions(element.props.children, out, element.props.label);
    } else if (element.type === "option") {
      out.push({
        value: String(element.props.value ?? ""),
        label: element.props.children,
        disabled: !!element.props.disabled,
        group,
      });
    }
  });
  return out;
}

/** What the closed control shows: inside a group the group's name comes
 *  first, as the option's own label may not say enough. */
function closedLabel(option: OptionItem | undefined): ReactNode {
  if (!option) return "";
  return option.group
    ? `${option.group} · ${textOf(option.label)}`
    : option.label;
}

/** The options split into runs that share a group, in order. */
function runs(options: OptionItem[]) {
  const out: {
    group?: string;
    items: { option: OptionItem; index: number }[];
  }[] = [];
  options.forEach((option, index) => {
    const last = out[out.length - 1];
    if (last && last.group === option.group) last.items.push({ option, index });
    else out.push({ group: option.group, items: [{ option, index }] });
  });
  return out;
}

/** An option label as plain text, for the sheet's rows and type-ahead. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node))
    return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

export function Select(props: SelectProps) {
  const phone = usePhoneLayout();
  return phone ? <MenuSelect {...props} /> : <DrawnSelect {...props} />;
}

/** A phone's: the app's menu, not the system's picker. */
function MenuSelect({
  value,
  onChange,
  children,
  className,
  disabled,
  "aria-label": ariaLabel,
  title,
}: SelectProps) {
  const options = collectOptions(children);
  const current = options.find((o) => o.value === value);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const items = runs(options).flatMap((run, r): ContextMenuEntry[] => [
    ...(r > 0 ? ["separator" as const] : []),
    ...run.items.map(({ option }) => ({
      label: textOf(closedLabel(option)),
      checked: option.value === value,
      disabled: option.disabled,
      onSelect: () => {
        if (option.value !== value)
          onChange({ target: { value: option.value } });
      },
    })),
  ]);
  return (
    <>
      <button
        type="button"
        ref={setButton}
        className={`ui-select ${className ?? ""}`}
        aria-haspopup="menu"
        aria-expanded={!!at}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        // Pressed again while open: closed, as the menu's own button is.
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt((open) => (open ? null : { x: r.left, y: r.bottom }));
        }}
      >
        <span className="tx-truncate ui-select-value">
          {closedLabel(current)}
        </span>
      </button>
      <Presence show={!!at}>
        {at && (
          <ContextMenu
            x={at.x}
            y={at.y}
            title={ariaLabel}
            items={items}
            anchor={button}
            onClose={() => setAt(null)}
          />
        )}
      </Presence>
    </>
  );
}

function DrawnSelect({
  value,
  onChange,
  children,
  className,
  disabled,
  "aria-label": ariaLabel,
  title,
}: SelectProps) {
  const options = collectOptions(children);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const {
    open,
    active,
    setActive,
    triggerRef,
    listRef,
    place,
    presence,
    listId,
    openMenu,
    close,
    choose,
    onListKey: listKeys,
    onTriggerKey,
  } = useDropdown({
    count: disabled ? 0 : options.length,
    selected: () => selectedIndex,
    isDisabled: (i) => !!options[i]?.disabled,
    choose: (index) => {
      const option = options[index];
      if (option.value !== value) onChange({ target: { value: option.value } });
    },
  });

  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    if (listKeys(e) || e.key.length !== 1) return;
    // Type-ahead: the next option starting with the typed character.
    const ch = e.key.toLowerCase();
    for (let i = 1; i <= options.length; i++) {
      const index = (active + i) % options.length;
      const text = textOf(options[index].label).toLowerCase();
      if (!options[index].disabled && text.startsWith(ch)) {
        setActive(index);
        break;
      }
    }
  }

  const current = options[selectedIndex];
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`ui-select ${className ?? ""}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKey}
      >
        <span className="tx-truncate ui-select-value">
          {closedLabel(current)}
        </span>
      </button>
      {presence.mounted && (
        <SelectMenu
          listRef={listRef}
          id={listId}
          state={presence.state}
          label={ariaLabel}
          activeId={`${listId}-${active}`}
          place={place}
          onKeyDown={onListKey}
        >
          {runs(options).map((run, r) => (
            <Fragment key={`run-${r}`}>
              {run.group !== undefined && (
                <li
                  role="presentation"
                  className="tx-list-heading ui-select-group"
                >
                  {run.group}
                </li>
              )}
              {run.items.map(({ option, index }) => (
                <li
                  key={`${option.value}-${index}`}
                  id={`${listId}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === selectedIndex}
                  aria-disabled={option.disabled || undefined}
                  className={`ui-select-option${index === active ? " is-active" : ""}`}
                  onMouseEnter={() => !option.disabled && setActive(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(index)}
                >
                  {option.label}
                </li>
              ))}
            </Fragment>
          ))}
        </SelectMenu>
      )}
    </>
  );
}
