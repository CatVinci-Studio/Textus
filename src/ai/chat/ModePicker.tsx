import { SelectMenu } from "../../engine/controls/SelectMenu";
import { Fragment, useId, useRef, useState, type KeyboardEvent } from "react";
import type { PanelMode } from "../../prefs/SettingsContext";
import { useMergedRef, usePresence } from "../../engine/motion/usePresence";
import { useFloatingList } from "../../engine/controls/useFloatingList";
import { AGENTS_GROUP, useChatModels, type ChatModels } from "./chat-models";
import "./ModePicker.css";
import { isImeKeydown } from "../../utils/ime";
import { listMove } from "../../engine/controls/list-keys";

export interface ModeChoice {
  value: PanelMode;
  label: string;
  /** One line on what the mode does, under its name in the list. */
  hint: string;
}

type Item =
  | { kind: "mode"; choice: ModeChoice }
  | { kind: "model"; provider: string; model: string };

/**
 * The composer's mode and model in one control: "Write · gpt-6.1-sol". One
 * list holds the modes, then the models grouped by provider. Without
 * `models` it is the mode alone; with one mode (Create), the model alone,
 * and nothing when there is no model to switch to either.
 */
export function ModePicker({
  mode,
  modes,
  onMode,
  models,
  labels,
  holdFocus = false,
}: {
  mode: PanelMode;
  modes: ModeChoice[];
  onMode: (mode: PanelMode) => void;
  models?: ChatModels;
  labels: { mode: string; model: string; picker: string };
  /** A tap leaves focus, and the phone's keyboard, in the message. */
  holdFocus?: boolean;
}) {
  const groups = models?.groups ?? [];
  // An external agent works its own way: Textus AI's modes are for models.
  const shownModes =
    modes.length > 1 && models?.provider !== AGENTS_GROUP ? modes : [];
  const items: Item[] = [
    ...shownModes.map((choice) => ({ kind: "mode" as const, choice })),
    ...groups.flatMap((g) =>
      g.models.map((model) => ({
        kind: "model" as const,
        provider: g.provider,
        model,
      })),
    ),
  ];
  const isSelected = (item: Item) =>
    item.kind === "mode"
      ? item.choice.value === mode
      : item.provider === models?.provider && item.model === models.model;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { triggerRef, listRef, place } = useFloatingList(
    open,
    active,
    () => setOpen(false),
    // The modes and a few providers' models, without a scroll.
    480,
  );
  const listId = useId();
  const presence = usePresence(open);
  const presenceRef = useMergedRef(listRef, presence.ref);

  // The list takes focus while open; with holdFocus it goes back to where
  // it was (the message), not to the trigger.
  const focusBefore = useRef<HTMLElement | null>(null);

  function openMenu() {
    focusBefore.current = document.activeElement as HTMLElement | null;
    setActive(Math.max(0, items.findIndex(isSelected)));
    setOpen(true);
  }

  function close(refocus = true) {
    setOpen(false);
    if (!refocus) return;
    if (holdFocus) focusBefore.current?.focus({ preventScroll: true });
    else triggerRef.current?.focus();
  }

  function choose(index: number) {
    const item = items[index];
    if (!item) return;
    close();
    if (isSelected(item)) return;
    if (item.kind === "mode") onMode(item.choice.value);
    else {
      models?.choose(item.provider, item.model);
      // An agent answers as itself: Research's paper isn't one of its modes.
      if (item.provider === AGENTS_GROUP && mode === "research" && modes[0])
        onMode(modes[0].value);
    }
  }

  function onTriggerKey(e: KeyboardEvent<HTMLElement>) {
    // Keys pressed before the open list has taken focus are its keys.
    if (open) return onListKey(e);
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openMenu();
    }
  }

  function onListKey(e: KeyboardEvent<HTMLElement>) {
    if (isImeKeydown(e)) return;
    const moved = listMove(e.key, active, items.length);
    if (moved !== null) {
      e.preventDefault();
      setActive(moved);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      // Closes the list, not the panel or Quick Ask around it.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close();
    }
  }

  const current = shownModes.find((m) => m.value === mode);
  const model = models?.model;
  if (items.length === 0) return null;
  const option = (item: Item, index: number) => (
    <li
      key={
        item.kind === "mode"
          ? item.choice.value
          : `${item.provider}/${item.model}`
      }
      id={`${listId}-${index}`}
      data-index={index}
      role="option"
      aria-selected={isSelected(item)}
      // A mode is named by its name; its line is the description.
      aria-labelledby={
        item.kind === "mode" ? `${listId}-${index}-name` : undefined
      }
      aria-describedby={
        item.kind === "mode" ? `${listId}-${index}-hint` : undefined
      }
      className={`ui-select-option${index === active ? " is-active" : ""}${
        item.kind === "mode" ? " mode-picker-mode" : ""
      }`}
      onMouseEnter={() => setActive(index)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => choose(index)}
    >
      {item.kind === "mode" ? (
        <span className="mode-picker-mode-text">
          <span
            id={`${listId}-${index}-name`}
            className="mode-picker-mode-name"
          >
            {item.choice.label}
          </span>
          <span
            id={`${listId}-${index}-hint`}
            className="mode-picker-mode-hint"
          >
            {item.choice.hint}
          </span>
        </span>
      ) : (
        item.model
      )}
    </li>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ui-select inline-chat-mode mode-picker"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={labels.picker}
        onMouseDown={holdFocus ? (e) => e.preventDefault() : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKey}
      >
        {current && <span className="mode-picker-value">{current.label}</span>}
        {model && (
          <span className="tx-truncate mode-picker-model" title={model}>
            {model}
          </span>
        )}
      </button>
      {presence.mounted && (
        <SelectMenu
          listRef={presenceRef}
          id={listId}
          state={presence.state}
          className="mode-picker-menu"
          label={labels.picker}
          activeId={`${listId}-${active}`}
          place={place}
          onKeyDown={onListKey}
        >
          {groups.length > 0 && shownModes.length > 0 && (
            <li role="presentation" className="ui-select-group">
              {labels.mode}
            </li>
          )}
          {shownModes.map((choice, i) => option({ kind: "mode", choice }, i))}
          {groups.length > 0 && shownModes.length > 0 && (
            <li
              role="presentation"
              className="ui-select-group mode-picker-models"
            >
              {labels.model}
            </li>
          )}
          {groups.map((g) => {
            const start = items.findIndex(
              (item) => item.kind === "model" && item.provider === g.provider,
            );
            return (
              <Fragment key={g.provider}>
                <li role="presentation" className="mode-picker-provider">
                  {g.label}
                </li>
                {g.models.map((m, i) =>
                  option(
                    { kind: "model", provider: g.provider, model: m },
                    start + i,
                  ),
                )}
              </Fragment>
            );
          })}
        </SelectMenu>
      )}
    </>
  );
}

/** The picker with the models under the modes, where the model can be
 *  switched. */
export function ModeAndModelPicker(
  props: Omit<Parameters<typeof ModePicker>[0], "models">,
) {
  return <ModePicker {...props} models={useChatModels()} />;
}
