import type { Strings, TextKey } from "../i18n/strings";
import { explainError } from "../utils/error-explain";

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
  | "model";

const PATTERNS: [AiErrorKind, RegExp][] = [
  ["notConfigured", /isn't set up yet|not configured/i],
  ["workspaceKey", /not scoped to a workspace|anthropic-workspace-id/i],
  // Before rate limits: some services send a used-up balance as a 429.
  [
    "balance",
    /\(402|payment required|insufficient[_ ](balance|quota|credits?|funds)|credit balance is too low|exceeded your current quota|exceeded_current_quota|arrearage|overdue|quota or balance ran out|余额不足|欠费/i,
  ],
  [
    "auth",
    /\(401|401 unauthorized|invalid[_ -]?(x-)?api[_ -]?key|incorrect api key|authentication_error|invalid_api_key|unauthorized/i,
  ],
  ["rateLimit", /\(429|rate[_ ]limit|too many requests|overloaded|\(529/i],
  [
    "model",
    /model_not_found|model .* (does not exist|not found)|unknown model|not supported when using/i,
  ],
  [
    "server",
    /\(5\d\d|internal server error|bad gateway|service unavailable|gateway timeout/i,
  ],
  ["timeout", /timed out|timeout/i],
  [
    "network",
    /error sending request|connection (refused|reset)|failed to lookup|dns error|tcp connect|network/i,
  ],
];

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
