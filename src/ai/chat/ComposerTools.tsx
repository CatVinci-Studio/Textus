import {
  CloseIcon,
  LightbulbIcon,
  SearchIcon,
} from "../../engine/controls/icons";
import { Tooltip } from "../../engine/controls/Tooltip";
import { rememberDeepThinking } from "./deep-thinking";
import type { ChatComposerLabels, ChatComposerProps } from "./composer-types";
import type { useRequestOptions } from "./useComposerState";

type HoldFocus = { onMouseDown?: (e: React.MouseEvent) => void };

/** The composer's web search and Deep thinking switches. */
export function ComposerToggles({
  labels,
  options,
  holdFocus,
}: {
  labels: ChatComposerLabels;
  options: ReturnType<typeof useRequestOptions>;
  holdFocus: HoldFocus;
}) {
  const { searchUnavailable, webSearch, setWebSearch } = options;
  const { deepThinking, setDeepThinking, canThinkDeeper } = options;
  return (
    <>
      <Tooltip
        side="above"
        description={
          webSearch && searchUnavailable ? labels.webSearchNeedsService : null
        }
        text={
          webSearch && searchUnavailable
            ? labels.webSearchNeedsService
            : webSearch
              ? labels.toggleOnHint.replace("{label}", labels.webSearch)
              : labels.webSearch
        }
      >
        <button
          type="button"
          className={`inline-chat-toggle inline-chat-web-search${webSearch ? " is-active" : ""}${
            webSearch && searchUnavailable ? " needs-setup" : ""
          }`}
          aria-label={labels.webSearch}
          aria-pressed={webSearch}
          {...holdFocus}
          onClick={() => setWebSearch(!webSearch)}
        >
          <SearchIcon />
        </button>
      </Tooltip>
      {canThinkDeeper && (
        <Tooltip
          side="above"
          description={labels.deepThinkingHint}
          text={
            deepThinking
              ? labels.toggleOnHint.replace("{label}", labels.deepThinkingHint)
              : labels.deepThinkingHint
          }
        >
          <button
            type="button"
            className={`inline-chat-toggle inline-chat-deep-thinking${deepThinking ? " is-active" : ""}`}
            aria-label={labels.deepThinking}
            aria-pressed={deepThinking}
            {...holdFocus}
            onClick={() => {
              rememberDeepThinking(!deepThinking);
              setDeepThinking(!deepThinking);
            }}
          >
            <LightbulbIcon />
          </button>
        </Tooltip>
      )}
    </>
  );
}

/** The kind picked with `/` (Research's piece, Create's making), while one
 *  is: a click on its × goes back to the model's choice. */
export function KindChip({
  kind,
  holdFocus,
}: {
  kind: NonNullable<ChatComposerProps["kind"]>;
  holdFocus: HoldFocus;
}) {
  return (
    <span className="inline-chat-selection-chip">
      <span className="inline-chat-chip-label">{kind.label}</span>
      <Tooltip text={kind.clearLabel} side="above">
        <button
          type="button"
          className="inline-chat-chip-remove"
          aria-label={kind.clearLabel}
          {...holdFocus}
          onClick={kind.clear}
        >
          <CloseIcon />
        </button>
      </Tooltip>
    </span>
  );
}
