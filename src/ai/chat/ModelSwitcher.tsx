import { useEffect, useId, useState } from "react";
import { useSettings } from "../../settings/SettingsContext";
import {
  useProviderCatalog,
  type ProviderCatalogEntry,
} from "../provider-catalog";
import {
  localizedLabel,
  useConnectedProviders,
} from "../../settings/sections/provider-connection";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";
import { Tooltip } from "../../ui/Tooltip";
import "./ModelSwitcher.css";

/** The model a provider's chat uses now: the one chosen for it, else its
 *  default. */
export function chatModel(
  entry: ProviderCatalogEntry,
  chosen: Record<string, string>,
): string {
  return (
    chosen[entry.id] || entry.agentDefaultModel || entry.knownModels[0] || ""
  );
}

/** The models to offer for a provider: the one in use first, then the rest
 *  it lists, each once. */
export function modelChoices(
  entry: ProviderCatalogEntry,
  chosen: Record<string, string>,
): string[] {
  const current = chatModel(entry, chosen);
  return [
    ...new Set([current, entry.agentDefaultModel ?? "", ...entry.knownModels]),
  ].filter(Boolean);
}

/** Whether there is anything to switch to: more than one model across
 *  the providers that are ready. With one, the button isn't shown. */
export function canSwitchModel(
  ready: ProviderCatalogEntry[],
  chosen: Record<string, string>,
): boolean {
  return (
    ready.reduce((n, entry) => n + modelChoices(entry, chosen).length, 0) > 1
  );
}

/**
 * The composer's model, switched without going to Settings: the button
 * names the model the next message goes to; its list holds the providers
 * set up in Settings › Textus AI (signed in, a key saved, or none needed)
 * with their models. Choosing one sets the chat provider and its model, as
 * Settings does.
 */
export function ModelSwitcher() {
  const { t, settings, setSettings } = useSettings();
  const catalog = useProviderCatalog();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const { connected } = useConnectedProviders(catalog, settings.aiProvider);
  const ref = useCloseOnOutsideClick<HTMLDivElement>(
    () => setOpen(false),
    true,
    open,
  );
  // Escape closes the list wherever the focus is: a press on the button
  // leaves it in the message box (onMouseDown below).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const active = catalog.find((e) => e.id === settings.aiProvider);
  const ready = catalog.filter(
    (e) =>
      e.id === settings.aiProvider ||
      connected[e.id]?.oauth ||
      connected[e.id]?.apiKey ||
      (e.keyOptional && e.id !== "custom"),
  );
  const model = active ? chatModel(active, settings.agentModels) : "";
  const choose = (entry: ProviderCatalogEntry, id: string) => {
    setSettings({
      aiProvider: entry.id,
      agentModels: { ...settings.agentModels, [entry.id]: id },
    });
    setOpen(false);
  };
  // One model to go to and nothing to switch to: no button taking room.
  if (!canSwitchModel(ready, settings.agentModels)) return null;

  return (
    <div className="model-switcher" ref={ref}>
      <Tooltip
        side="above"
        text={`${t.chatModelLabel}: ${active ? localizedLabel(active, t) : settings.aiProvider} · ${model}`}
      >
        <button
          type="button"
          className="model-switcher-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={`${t.chatModelLabel}: ${model}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
        >
          {model}
        </button>
      </Tooltip>
      {open && (
        <div
          id={listId}
          className="model-switcher-list floating-surface"
          role="listbox"
          aria-label={t.chatModelLabel}
        >
          {ready.map((entry) => (
            <div
              key={entry.id}
              role="group"
              aria-label={localizedLabel(entry, t)}
            >
              <div className="model-switcher-provider">
                {localizedLabel(entry, t)}
              </div>
              {modelChoices(entry, settings.agentModels).map((id) => {
                const selected =
                  entry.id === settings.aiProvider && id === model;
                return (
                  <button
                    key={id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`model-switcher-option${selected ? " is-selected" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(entry, id)}
                  >
                    {id}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
