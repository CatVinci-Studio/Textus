import type { Strings } from "../../i18n/strings";
import type { RevisionDisplay } from "../../settings/SettingsContext";
import type { EditProposal } from "../types";

/** A revision display's name, for the settings list and the review bar's
 *  menu. */
export function revisionDisplayName(t: Strings, mode: RevisionDisplay): string {
  return {
    inline: t.revisionDisplayInline,
    original: t.revisionDisplayOriginal,
    new: t.revisionDisplayNew,
    final: t.revisionDisplayFinal,
  }[mode];
}

/** Whether a display puts one side of each change in the margin. */
export function needsMargin(mode: RevisionDisplay): boolean {
  return mode === "original" || mode === "new";
}

/**
 * The display actually drawn: the margin views need a margin, and fall
 * back to everything in the text where there is none (a narrow window, a
 * phone). The chosen display is kept, and applies again once there is.
 */
export function effectiveRevisionDisplay(
  mode: RevisionDisplay,
  marginAvailable: boolean,
): RevisionDisplay {
  return !marginAvailable && needsMargin(mode) ? "inline" : mode;
}

/**
 * Whether a margin view is listed but can't be picked: there is no room
 * for a margin (margin-room.ts) where there could be one. A phone never
 * has a margin, so nothing there is blocked or explained - it lists only
 * the views that need none. The review bar's menu and Settings both ask
 * this.
 */
export function marginViewBlocked(
  mode: RevisionDisplay,
  { phone, marginAvailable }: { phone: boolean; marginAvailable: boolean },
): boolean {
  return !phone && !marginAvailable && needsMargin(mode);
}

/**
 * Whether a proposal only adds text (what Write proposes): there is no
 * original for a margin view to set beside it, so it is drawn as a green
 * block in the text in every view but "final", where it reads as the
 * result.
 */
export function addsTextOnly(proposal: EditProposal): boolean {
  return (
    proposal.action === "append" ||
    proposal.action === "insert_at_cursor" ||
    proposal.action === "insert_before" ||
    proposal.action === "insert_after"
  );
}
