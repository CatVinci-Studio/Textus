/**
 * What kind of failure a provider error is, so the chat can say what to do in
 * the user's language above the provider's own message. Unrecognized errors
 * show as they came.
 */
export type AiErrorKind =
  | "notConfigured"
  | "auth"
  | "workspaceKey"
  | "rateLimit"
  | "server"
  | "timeout"
  | "network"
  | "model";

const PATTERNS: [AiErrorKind, RegExp][] = [
  ["notConfigured", /isn't set up yet|not configured/i],
  ["workspaceKey", /not scoped to a workspace|anthropic-workspace-id/i],
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
