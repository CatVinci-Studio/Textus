import {
  Children,
  Fragment,
  isValidElement,
  useId,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { isIOSApp } from "../platform/capabilities";
import { useMergedRef, usePresence } from "./usePresence";
import { useFloatingList } from "./useFloatingList";
import "./Select.css";
import { isImeKeydown } from "../utils/ime";

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

export interface SelectProps {
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
  return isIOSApp ? <NativeSelect {...props} /> : <DrawnSelect {...props} />;
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
      <span className="ui-select-value" aria-hidden="true">
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
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { triggerRef, listRef, place } = useFloatingList(open, active, () =>
    setOpen(false),
  );
  const listId = useId();
  // The list stays a moment after it closes, shrinking back into the
  // trigger; the choice has already gone through by then.
  const presence = usePresence(open, { exitMs: 120 });
  const presenceRef = useMergedRef(listRef, presence.ref);

  function openMenu() {
    if (disabled || options.length === 0) return;
    setActive(Math.max(0, selectedIndex));
    setOpen(true);
  }

  function close(refocus = true) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    close();
    if (option.value !== value) onChange({ target: { value: option.value } });
  }

  function step(from: number, delta: number) {
    for (let i = 1; i <= options.length; i++) {
      const next = (from + delta * i + options.length) % options.length;
      if (!options[next].disabled) return next;
    }
    return from;
  }

  function onTriggerKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openMenu();
    }
  }

  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    if (isImeKeydown(e)) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => step(i, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? step(-1, 1) : step(0, -1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      // Closes the list, not the dialog the select sits in.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close();
    } else if (e.key.length === 1) {
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
        <span className="ui-select-value">{closedLabel(current)}</span>
      </button>
      {presence.mounted &&
        createPortal(
          <ul
            ref={presenceRef}
            id={listId}
            data-state={presence.state}
            inert={presence.state === "closing" || undefined}
            className="ui-select-menu floating-surface"
            role="listbox"
            aria-label={ariaLabel}
            aria-activedescendant={`${listId}-${active}`}
            tabIndex={-1}
            style={place}
            data-floating-select=""
            onKeyDown={onListKey}
          >
            {runs(options).map((run, r) => (
              <Fragment key={`run-${r}`}>
                {run.group !== undefined && (
                  <li role="presentation" className="ui-select-group">
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
          </ul>,
          document.body,
        )}
    </>
  );
}
