import type { Strings } from "../../i18n/strings";
import { canSwitch, type PluginStatus } from "./lifecycle";
import type { CardRequest, CardResult } from "./plugin-card";

/** What textus.offerPlugin reaches: the store and the suggestion card in
 *  the app, stand-ins in tests. */
export interface OfferDeps {
  /** Whether the market catalog has an official plugin with this id. */
  official(id: string): Promise<boolean>;
  /** How the installed plugin stands; undefined when it isn't installed. */
  status(id: string): PluginStatus | undefined;
  /** The suggestion card's answer (plugin-card.ts showPluginCard). */
  card(request: CardRequest): Promise<CardResult>;
  /** Installs the card's plugin or turns it on, asking for what it needs,
   *  as any card does (open-offer.ts takeUp); whether it is on now. */
  takeUp(request: CardRequest, t: Strings): Promise<boolean>;
}

/** The plugin that made the offer. */
export interface OfferCaller {
  id: string;
  name: string;
}

/**
 * textus.offerPlugin({ id }): a plugin suggests an official one on
 * the suggestion card, and the user installs it or turns it on - or not.
 * Resolves whether it is on. The card shows one at a time, and once the
 * user says × (or Later three times) that plugin's offer of it isn't shown
 * again, so a plugin can't walk them through the catalog.
 */
export function pluginOffer(deps: OfferDeps) {
  return async (
    caller: OfferCaller,
    request: unknown,
    t: Strings,
  ): Promise<boolean> => {
    const { id } = (request ?? {}) as Record<string, unknown>;
    if (typeof id !== "string") return false;
    if (!(await deps.official(id))) return false;
    const status = deps.status(id);
    if (status === "on") return true;
    if (status && !canSwitch(status)) return false;
    const card: CardRequest = {
      plugin: id,
      situation: { type: "offer", caller },
      installed: !!status,
    };
    if ((await deps.card(card)) !== "install") return false;
    return deps.takeUp(card, t);
  };
}
