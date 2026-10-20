import { useState, type CSSProperties } from "react";
import type { Strings } from "../../i18n/strings";
import type { FindReplace } from "./useFindReplace";
import { ArrowUpIcon, ChevronIcon, CloseIcon } from "../../ui/icons";
import { usePresenceProps } from "../../ui/usePresence";
import { useDockedPanelWidth } from "../../utils/hooks/useDockedPanelWidth";
import { Tooltip } from "../../ui/Tooltip";
import "./FindReplaceBar.css";

type FindReplaceBarLabels = Pick<
  Strings,
  | "findPlaceholder"
  | "replacePlaceholder"
  | "replace"
  | "replaceAll"
  | "matchCase"
  | "useRegex"
  | "invalidRegex"
  | "noMatches"
  | "findPreviousMatch"
  | "findNextMatch"
  | "findClose"
>;

interface FindReplaceBarProps {
  findReplace: FindReplace;
  labels: FindReplaceBarLabels;
}

export function FindReplaceBar({ findReplace, labels }: FindReplaceBarProps) {
  const [replaceOpen, setReplaceOpen] = useState(false);
  const { query, replacement, caseSensitive, useRegex, status } = findReplace;
  const presence = usePresenceProps<HTMLDivElement>();
  const dockedWidth = useDockedPanelWidth();

  function onFindKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) findReplace.prev();
      else findReplace.next();
    }
  }

  function onReplaceKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      findReplace.replaceOne();
    }
  }

  // Escape handled once here for both inputs; stopPropagation keeps bar
  // keystrokes out of the app-level shortcut dispatcher.
  function onBarKeyDown(e: React.KeyboardEvent) {
    const composing = e.nativeEvent.isComposing || e.keyCode === 229;
    if (e.key === "Escape" && !composing) {
      e.preventDefault();
      findReplace.close();
    }
    e.stopPropagation();
  }

  const countLabel = status.error
    ? labels.invalidRegex
    : query
      ? status.matchCount > 0
        ? `${status.activeIndex + 1} / ${status.matchCount}`
        : labels.noMatches
      : "";

  return (
    <div
      {...presence}
      className="find-replace-bar floating-surface"
      style={{ "--docked-panel-width": `${dockedWidth}px` } as CSSProperties}
      onKeyDown={onBarKeyDown}
    >
      <div className="find-replace-row">
        <Tooltip text={labels.replace}>
          <button
            type="button"
            aria-label={labels.replace}
            className={`find-replace-chevron ${replaceOpen ? "find-replace-chevron-open" : ""}`}
            onClick={() => setReplaceOpen((v) => !v)}
          >
            <ChevronIcon />
          </button>
        </Tooltip>
        <div className="find-replace-field">
          <input
            className="find-replace-input"
            type="text"
            value={query}
            placeholder={labels.findPlaceholder}
            autoFocus
            onChange={(e) => findReplace.setQuery(e.target.value)}
            onKeyDown={onFindKeyDown}
          />
          <span
            className={`find-replace-count ${status.error ? "find-replace-count-error" : ""}`}
          >
            {countLabel}
          </span>
          <Tooltip text={labels.matchCase}>
            <button
              type="button"
              className={`find-replace-toggle ${caseSensitive ? "find-replace-toggle-active" : ""}`}
              onClick={findReplace.toggleCaseSensitive}
            >
              Aa
            </button>
          </Tooltip>
          <Tooltip text={labels.useRegex}>
            <button
              type="button"
              className={`find-replace-toggle ${useRegex ? "find-replace-toggle-active" : ""}`}
              onClick={findReplace.toggleUseRegex}
            >
              .*
            </button>
          </Tooltip>
        </div>
        <div className="find-replace-nav">
          <Tooltip text={labels.findPreviousMatch}>
            <button
              type="button"
              onClick={findReplace.prev}
              disabled={status.matchCount === 0}
              aria-label={labels.findPreviousMatch}
            >
              <ArrowUpIcon />
            </button>
          </Tooltip>
          <Tooltip text={labels.findNextMatch}>
            <button
              type="button"
              onClick={findReplace.next}
              disabled={status.matchCount === 0}
              aria-label={labels.findNextMatch}
            >
              {/* Same arrow, flipped - see ArrowUpIcon. */}
              <ArrowUpIcon className="find-replace-arrow-down" />
            </button>
          </Tooltip>
          <Tooltip text={labels.findClose}>
            <button
              type="button"
              className="find-replace-close"
              onClick={findReplace.close}
              aria-label={labels.findClose}
            >
              <CloseIcon />
            </button>
          </Tooltip>
        </div>
      </div>
      {replaceOpen && (
        <div className="find-replace-row">
          <span className="find-replace-chevron-spacer" />
          <div className="find-replace-field">
            <input
              className="find-replace-input"
              type="text"
              value={replacement}
              placeholder={labels.replacePlaceholder}
              onChange={(e) => findReplace.setReplacement(e.target.value)}
              onKeyDown={onReplaceKeyDown}
            />
          </div>
          <div className="find-replace-nav">
            <button
              type="button"
              className="find-replace-text"
              onClick={findReplace.replaceOne}
              disabled={status.matchCount === 0}
            >
              {labels.replace}
            </button>
            <button
              type="button"
              className="find-replace-text"
              onClick={findReplace.replaceAll}
              disabled={status.matchCount === 0}
            >
              {labels.replaceAll}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
