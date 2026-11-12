import type { Strings, TextKey } from "../i18n/strings";
import { explainError } from "../utils/error-explain";
import KINDS from "./ai-error-kinds.json";

/**
 * What kind of failure a provider error is, so Textus can say what to do in
 * the user's language above the provider's own message. Unrecognized errors
 * show as they came.
 */
export type AiErrorKind =
  | "notConfigured"
  | "auth"
  | "workspaceKey"
  | "balance"
  | "rateLimit"
  | "server"
  | "timeout"
  | "network"
  | "model"
  | "contextLength";

/** The kinds' patterns, first match wins - a used-up balance before rate
 *  limits, since some services send it as a 429. One list with the
 *  backend's retries (ai/error_kind.rs). */
const PATTERNS: [AiErrorKind, RegExp][] = KINDS.map(({ kind, pattern }) => [
  kind as AiErrorKind,
  new RegExp(pattern, "i"),
]);

export function classifyAiError(text: string): AiErrorKind | null {
  for (const [kind, pattern] of PATTERNS) if (pattern.test(text)) return kind;
  return null;
}

const TEXT: Record<AiErrorKind, TextKey> = {
  notConfigured: "aiErrorNotConfigured",
  auth: "aiErrorAuth",
  workspaceKey: "aiErrorWorkspaceKey",
  balance: "aiErrorBalance",
  rateLimit: "aiErrorRateLimit",
  server: "aiErrorServer",
  timeout: "aiErrorTimeout",
  network: "aiErrorNetwork",
  model: "aiErrorModel",
  contextLength: "aiErrorContextLength",
};

/** What to do about each kind, in the user's language. */
export function aiErrorTexts(t: Strings): Record<AiErrorKind, string> {
  return Object.fromEntries(
    Object.entries(TEXT).map(([kind, key]) => [kind, t[key]]),
  ) as Record<AiErrorKind, string>;
}

/** The provider's message with what to do above it, when Textus knows;
 *  other failures as {@link explainError} says them. */
export function explainAiError(text: string, t: Strings): string {
  const kind = classifyAiError(text);
  return kind ? `${t[TEXT[kind]]}\n${text}` : explainError(text, t);
}
