import { getUiState, setUiState } from "../../storage/ui-state";
import { extname } from "../../utils/path";

/**
 * The one card at the bottom right that suggests an official plugin: for
 * what a document holds, for a plugin that asked (textus.offerPlugin), or
 * for a file nothing opens. One shows at a time; it never takes the focus
 * and stays until the user answers. Later asks again next time, three times
 * at most; × never asks again for that situation, until restored in
 * Settings › Extensions.
 */

export type CardSituation =
  | { type: "offer"; caller: { id: string; name: string } }
  | { type: "content"; kind: string }
  | { type: "open"; path: string };

export interface CardRequest {
  /** The suggested plugin's id, in the catalog. */
  plugin: string;
  /** Plain text: a plugin's reason, or what the document holds. */
  reason: string;
  situation: CardSituation;
  /** Installed but off: the card turns it on. */
  installed: boolean;
}

/** "install" covers turning on; "system" opens a file in the system's app. */
export type CardChoice = "install" | "system" | "later" | "never";

/** What a card's answer was, or why none was asked. */
export type CardResult = CardChoice | "busy" | "muted";

/** How many times Later may put a card off before it stops coming. */
export const LATER_LIMIT = 3;

/** The situation's key: what Later and × are remembered by. */
export function cardKey(request: CardRequest): string {
  const s = request.situation;
  if (s.type === "offer") return `offer:${s.caller.id}:${request.plugin}`;
  if (s.type === "content") return `content:${s.kind}`;
  return `open:${extname(s.path).toLowerCase() || s.path}`;
}

/** Laters so far by key, or "never". Kept here too where UI state isn't. */
let answers: Record<string, number | "never"> | null = null;

function saved(): Record<string, number | "never"> {
  if (answers) return answers;
  const read = getUiState("pluginCardAnswers");
  answers =
    read && typeof read === "object"
      ? { ...(read as Record<string, number | "never">) }
      : {};
  return answers;
}

function remember(key: string, value: number | "never" | undefined) {
  const next = { ...saved() };
  if (value === undefined) delete next[key];
  else next[key] = value;
  answers = next;
  setUiState("pluginCardAnswers", next);
}

/** Whether the user put this situation's cards away for good. */
export function cardMuted(key: string): boolean {
  const value = saved()[key];
  return (
    value === "never" || (typeof value === "number" && value >= LATER_LIMIT)
  );
}

/** How many situations' cards were put away, for Settings. */
export function mutedCardCount(): number {
  return Object.keys(saved()).filter(cardMuted).length;
}

/** Settings › Extensions' Restore: every card may come again. */
export function restoreCards(): void {
  answers = {};
  setUiState("pluginCardAnswers", {});
  changed();
}

interface Shown {
  request: CardRequest;
  resolve: (choice: CardChoice) => void;
}

let shown: Shown | null = null;
const waiting: Shown[] = [];
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

export function subscribePluginCard(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The card on screen, if any. */
export function currentPluginCard(): CardRequest | null {
  return shown?.request ?? null;
}

/** Shows a card and resolves with the user's answer. An offer finds the
 *  card taken "busy"; content and open cards wait their turn. */
export function showPluginCard(request: CardRequest): Promise<CardResult> {
  const key = cardKey(request);
  if (cardMuted(key)) return Promise.resolve("muted");
  const same = (s: Shown) => cardKey(s.request) === key;
  if (shown && (request.situation.type === "offer" || same(shown)))
    return Promise.resolve("busy");
  if (waiting.some(same)) return Promise.resolve("busy");
  return new Promise<CardChoice>((resolve) => {
    const entry: Shown = {
      request,
      resolve: (choice) => {
        if (choice === "later") remember(key, (Number(saved()[key]) || 0) + 1);
        else if (choice === "never") remember(key, "never");
        else remember(key, undefined);
        resolve(choice);
      },
    };
    if (shown) waiting.push(entry);
    else {
      shown = entry;
      changed();
    }
  });
}

/** The user's answer to the card on screen; the next one waiting shows. */
export function answerPluginCard(choice: CardChoice): void {
  const done = shown;
  shown = waiting.shift() ?? null;
  done?.resolve(choice);
  changed();
}
