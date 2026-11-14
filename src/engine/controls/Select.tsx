import { SelectMenu } from "./SelectMenu";
import {
  Children,
  Fragment,
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { isMobileApp } from "../../platform/capabilities";
import { useDropdown } from "./useDropdown";
import "./Select.css";

/** A drop-in for `<select>` whose list the app draws, in a portal marked
 *  `data-floating-select` so outside-click code treats it as inside its opener.
 *  On iOS it is a native select laid invisibly over the control. */
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

/** An option label as plain text, for the native list (which shows text
 *  only) and type-ahead. */
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
  return isMobileApp ? <NativeSelect {...props} /> : <DrawnSelect {...props} />;
}

function NativeSelect({
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
  return (
    <span
      className={`ui-select ui-select-native-frame ${className ?? ""}`}
      aria-disabled={disabled || undefined}
    >
      <span className="tx-truncate ui-select-value" aria-hidden="true">
        {closedLabel(current)}
      </span>
      <select
        className="ui-select-native"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        title={title}
        onChange={(e) => onChange({ target: { value: e.target.value } })}
      >
        {runs(options).map((run, r) => {
          const items = run.items.map(({ option, index }) => (
            <option
              key={`${option.value}-${index}`}
              value={option.value}
              disabled={option.disabled}
            >
              {textOf(option.label)}
            </option>
          ));
          return run.group === undefined ? (
            <Fragment key={`run-${r}`}>{items}</Fragment>
          ) : (
            <optgroup key={`run-${r}`} label={run.group}>
              {items}
            </optgroup>
          );
        })}
      </select>
    </span>
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
