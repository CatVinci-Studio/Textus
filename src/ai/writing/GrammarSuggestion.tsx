import { useMemo } from "react";
import { GrammarPopover, applyLabel } from "./GrammarPopover";
import type { useGrammarPopover } from "./useGrammarPopover";
import { BottomCard } from "../../ui/BottomCard";
import { Presence } from "../../ui/usePresence";
import type { Strings } from "../../i18n/strings";

/** The suggestion for the grammar issue under the pointer or caret: a
 *  popover beside it, or on a phone a card from the bottom. */
export function GrammarSuggestion({
  grammar,
  phone,
  t,
  onStale,
}: {
  grammar: ReturnType<typeof useGrammarPopover>;
  phone: boolean;
  t: Strings;
  /** The phone card's fix no longer fits the text (the card has closed). */
  onStale: () => void;
}) {
  const grammarLabels = useMemo(
    () => ({
      grammarKinds: {
        spelling: t.grammarKindSpelling,
        grammar: t.grammarKindGrammar,
        punctuation: t.grammarKindPunctuation,
        rules: t.grammarKindRules,
      },
      grammarApplyTo: t.grammarApplyTo,
      grammarApply: t.grammarApply,
      grammarIgnore: t.grammarIgnore,
      grammarPrevious: t.grammarPrevious,
      grammarNext: t.grammarNext,
    }),
    [t],
  );

  return (
    <>
      <Presence show={!!grammar.popover && phone} exitMs={250}>
        {grammar.popover && phone && (
          // A fix that no longer fits the text says so in the notice, the
          // card having closed on the tap.
          <BottomCard
            label={grammarLabels.grammarKinds[grammar.popover.kind]}
            actions={[
              { label: t.grammarIgnore, onSelect: grammar.ignore },
              {
                label: applyLabel(
                  grammarLabels,
                  grammar.popover.shownSuggestion ?? grammar.popover.suggestion,
                ),
                primary: true,
                onSelect: () => {
                  if (!grammar.applyFix()) onStale();
                },
              },
            ]}
            onClose={grammar.hide}
          >
            <span
              className={`grammar-kind grammar-kind-${grammar.popover.kind}`}
            >
              {grammarLabels.grammarKinds[grammar.popover.kind]}
            </span>
            <div className="grammar-card-fix">
              {grammar.popover.original && (
                <s>
                  {grammar.popover.shownOriginal ?? grammar.popover.original}
                </s>
              )}
              {grammar.popover.original && " → "}
              <b>
                {grammar.popover.shownSuggestion ??
                  (grammar.popover.suggestion || "∅")}
              </b>
            </div>
            {grammar.popover.issue && (
              <div className="grammar-card-issue">{grammar.popover.issue}</div>
            )}
          </BottomCard>
        )}
      </Presence>
      <Presence show={!!grammar.popover && !phone} exitMs={120}>
        {grammar.popover && !phone && (
          <GrammarPopover
            info={grammar.popover}
            labels={grammarLabels}
            error={grammar.applyError}
            onApply={grammar.applyFix}
            onIgnore={grammar.ignore}
            onStep={grammar.step}
            onMouseEnter={grammar.cancelHide}
            onMouseLeave={grammar.hide}
          />
        )}
      </Presence>
    </>
  );
}
