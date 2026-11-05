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
    options: {
      title: string;
      okLabel: string;
      cancelLabel: string;
      focusCancel: boolean;
    },
  ): Promise<boolean>;
  install(id: string): Promise<void>;
  turnOn(id: string): Promise<void>;
  /** Install or turn-on failed after the user said yes. */
  failed(error: unknown, t: Strings): void;
}

/** The plugin that made the offer. */
export interface OfferCaller {
  id: string;
  name: string;
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
 * on. One dialog at a time, and a plugin the user said no to once isn't
 * heard again in this window, so it can't walk them through the catalog.
 */
export function pluginOffer(deps: OfferDeps) {
  let asking = false;
  const muted = new Set<string>();
  return async (
    caller: OfferCaller,
    request: unknown,
    t: Strings,
  ): Promise<boolean> => {
    const { id, reason } = (request ?? {}) as Record<string, unknown>;
    if (typeof id !== "string") return false;
    const plugin = await deps.official(id);
    if (!plugin) return false;
    const status = deps.status(id);
    if (status === "on") return true;
    if (status && !canSwitch(status)) return false;
    if (asking || muted.has(caller.id)) return false;
    asking = true;
    try {
      const why = shortReason(reason);
      const text = fill(
        status ? t.pluginOfferTurnOn : t.pluginOfferInstall,
        plugin,
      );
      // Unasked for, so a key typed as it opens mustn't say yes.
      const ok = await deps.confirm(
        why ? `${text}\n\n${fill(t.pluginOfferReason, { reason: why })}` : text,
        {
          title: caller.name,
          okLabel: status ? t.pluginTurnOn : t.pluginInstall,
          cancelLabel: t.cancel,
          focusCancel: true,
        },
      );
      if (!ok) {
        muted.add(caller.id);
        return false;
      }
      await (status ? deps.turnOn(id) : deps.install(id));
    } catch (error) {
      deps.failed(error, t);
    } finally {
      asking = false;
    }
    return deps.status(id) === "on";
  };
}
