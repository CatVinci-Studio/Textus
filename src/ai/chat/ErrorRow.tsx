import { classifyAiError, type AiErrorKind } from "../error-messages";

/** The error row, with a retry button when the failed send is resendable
 *  (`onRetry` null otherwise). */
export function ErrorRow({
  error,
  retryLabel,
  onRetry,
  explanations,
}: {
  error: string;
  retryLabel: string;
  onRetry: (() => void) | null;
  /** What to do, per recognized kind of failure. */
  explanations?: Partial<Record<AiErrorKind, string>>;
}) {
  const kind = classifyAiError(error);
  const explanation = kind ? explanations?.[kind] : undefined;
  return (
    <div className="agent-error">
      {explanation && (
        <div className="agent-error-explanation">{explanation}</div>
      )}
      <div className={explanation ? "agent-error-detail" : undefined}>
        {error}
      </div>
      {onRetry && (
        <button
          className="inline-chat-action agent-error-retry"
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
