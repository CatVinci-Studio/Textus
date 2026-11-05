import type { Strings } from "../../i18n/strings";
import { canSwitch, type PluginStatus } from "./lifecycle";

/** What textus.offerPlugin reaches: the store and dialogs in the app,
 *  stand-ins in tests. */
export interface OfferDeps {
  /** The official plugin with this id in the market catalog, named and
   *  described in the UI language; null for any other id. */
  official(id: string): Promise<{ name: string; description: string } | null>;
  /** How the installed plugin stands; undefined when it isn't installed. */
  status(id: string): PluginStatus | undefined;
  confirm(
    text: string,
    labels: { okLabel: string; cancelLabel: string },
  ): Promise<boolean>;
  install(id: string): Promise<void>;
  turnOn(id: string): Promise<void>;
}

const REASON_MAX = 120;

/** The caller's reason as one short line of plain text. */
export function shortReason(reason: unknown): string {
  const line =
    typeof reason === "string" ? reason.replace(/\s+/g, " ").trim() : "";
  return line.length > REASON_MAX
    ? `${line.slice(0, REASON_MAX - 1).trimEnd()}…`
    : line;
}

// One pass, so a name or reason holding "{description}" or "$&" stays as written.
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) =>
    key in values ? values[key] : all,
  );
}

/**
 * textus.offerPlugin({ id, reason }): a plugin suggests an official one,
 * and the user installs it or turns it on - or not. Resolves whether it is
 * on. One offer at a time, and one the user declined isn't asked again
 * while Textus runs, so a plugin calling it in a loop can't pile up dialogs.
 */
export function pluginOffer(deps: OfferDeps) {
  let asking = false;
  const declined = new Set<string>();
  return async (request: unknown, t: Strings): Promise<boolean> => {
    const { id, reason } = (request ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || asking || declined.has(id)) return false;
    asking = true;
    try {
      const plugin = await deps.official(id);
      if (!plugin) return false;
      const status = deps.status(id);
      if (status === "on") return true;
      if (status && !canSwitch(status)) return false;
      const why = shortReason(reason);
      const text = fill(
        status ? t.pluginOfferTurnOn : t.pluginOfferInstall,
        plugin,
      );
      const ok = await deps.confirm(
        why ? `${text}\n\n${fill(t.pluginOfferReason, { reason: why })}` : text,
        {
          okLabel: status ? t.pluginTurnOn : t.pluginInstall,
          cancelLabel: t.cancel,
        },
      );
      if (!ok) {
        declined.add(id);
        return false;
      }
      await (status ? deps.turnOn(id) : deps.install(id));
      return deps.status(id) === "on";
    } finally {
      asking = false;
    }
  };
}
