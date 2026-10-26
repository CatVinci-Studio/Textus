import { Fragment, useId, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { AgentMode } from "../../settings/SettingsContext";
import { useMergedRef, usePresence } from "../../ui/usePresence";
import { useFloatingList } from "../../ui/useFloatingList";
import { useChatModels, type ChatModels } from "./chat-models";
import "./ModePicker.css";

export interface ModeChoice {
  value: AgentMode;
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
 * `models` it is the mode alone.
 */
export function ModePicker({
  mode,
  modes,
  onMode,
  models,
  labels,
}: {
  mode: AgentMode;
  modes: ModeChoice[];
  onMode: (mode: AgentMode) => void;
  models?: ChatModels;
  labels: { mode: string; model: string; picker: string };
}) {
  const groups = models?.groups ?? [];
  const items: Item[] = [
    ...modes.map((choice) => ({ kind: "mode" as const, choice })),
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
  const presence = usePresence(open, { exitMs: 120 });
  const presenceRef = useMergedRef(listRef, presence.ref);

  function openMenu() {
    setActive(Math.max(0, items.findIndex(isSelected)));
    setOpen(true);
  }

  function close(refocus = true) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function choose(index: number) {
    const item = items[index];
    if (!item) return;
    close();
    if (isSelected(item)) return;
    if (item.kind === "mode") onMode(item.choice.value);
    else models?.choose(item.provider, item.model);
  }

  function onTriggerKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openMenu();
    }
  }

  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    if (e.nativeEvent.isComposing) return;
    const n = items.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + delta + n) % n);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : n - 1);
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

  const current = modes.find((m) => m.value === mode);
  const model = models?.model;
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
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKey}
      >
        <span className="mode-picker-value">{current?.label}</span>
        {model && (
          <span className="mode-picker-model" title={model}>
            {model}
          </span>
        )}
      </button>
      {presence.mounted &&
        createPortal(
          <ul
            ref={presenceRef}
            id={listId}
            data-state={presence.state}
            inert={presence.state === "closing" || undefined}
            className="ui-select-menu mode-picker-menu floating-surface"
            role="listbox"
            aria-label={labels.picker}
            aria-activedescendant={`${listId}-${active}`}
            tabIndex={-1}
            style={place}
            data-floating-select=""
            onKeyDown={onListKey}
          >
            {groups.length > 0 && (
              <li role="presentation" className="ui-select-group">
                {labels.mode}
              </li>
            )}
            {modes.map((choice, i) => option({ kind: "mode", choice }, i))}
            {groups.length > 0 && (
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
          </ul>,
          document.body,
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
