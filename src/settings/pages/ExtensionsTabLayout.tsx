import { SearchField } from "../../engine/controls/SearchField";
import { useMenuButton } from "../../engine/controls/useMenuButton";
import type { ReactNode } from "react";
import type { Strings } from "../../i18n/strings";
import { RowHelp } from "../sections/controls";
import { SettingsGroup } from "./SettingsGroup";

export interface ExtensionsAction {
  label: string;
  onSelect: () => void;
}

/** A list of things one adds to Textus - themes, skills, MCP servers:
 *  `top` (a switch over all of them), one search over both lists while it
 *  is long, then what is installed - its section's heading holding what
 *  acts on the list (⋯, the main action) and its "?" - what is available,
 *  and Advanced, folded. Sections and rows as every Settings page has. */
export function ExtensionsTabLayout({
  t,
  intro,
  help,
  primary,
  actions = [],
  error,
  query,
  onQuery,
  top,
  off = false,
  installedTitle,
  installedCount,
  installedAction,
  installed,
  available,
  footer,
  advanced,
}: {
  t: Strings;
  /** What the list is, for its "?" (with `help`). */
  intro: string;
  help?: ReactNode;
  primary?: ExtensionsAction;
  actions?: ExtensionsAction[];
  error?: string | null;
  query?: string;
  onQuery?: (query: string) => void;
  top?: ReactNode;
  /** `top` turned everything off: what's under it is quieter. */
  off?: boolean;
  installedTitle: string;
  installedCount?: number;
  /** Beside the installed list's title, while there is something to do. */
  installedAction?: ReactNode;
  installed: ReactNode;
  available?: ReactNode;
  footer?: ReactNode;
  advanced?: ReactNode;
}) {
  return (
    <>
      {top}
      <div className={off ? "extensions-off" : undefined}>
        {onQuery && (
          <SearchField
            className="plugin-search"
            placeholder={t.marketSearch}
            aria-label={t.marketSearch}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        )}
        <SettingsGroup
          title={
            installedCount
              ? `${installedTitle} ${installedCount}`
              : installedTitle
          }
          actions={
            <>
              {installedAction}
              {help && <RowHelp label={intro}>{help}</RowHelp>}
              {actions.length > 0 && <MoreMenu t={t} actions={actions} />}
              {primary && (
                <button
                  type="button"
                  className="text-button settings-inline-button"
                  onClick={primary.onSelect}
                >
                  {primary.label}
                </button>
              )}
            </>
          }
        >
          {error && (
            <div className="settings-error" role="alert">
              {error}
            </div>
          )}
          {installed}
        </SettingsGroup>
        {available}
        {footer}
      </div>
      {advanced && (
        <details className="disclosure settings-advanced extensions-advanced">
          <summary>{t.agentAdvancedGroupLabel}</summary>
          <div className="settings-advanced-body">{advanced}</div>
        </details>
      )}
    </>
  );
}

/** The tab's other actions - install from a file, import, add by hand -
 *  behind one "…" button. */
function MoreMenu({ t, actions }: { t: Strings; actions: ExtensionsAction[] }) {
  const { button, menu } = useMenuButton(
    () => actions.map((a) => ({ label: a.label, onSelect: a.onSelect })),
    { alignEnd: true },
  );
  return (
    <div className="extensions-more">
      <button
        type="button"
        className="text-button settings-inline-button extensions-more-button"
        aria-label={t.toolbarMore}
        {...button}
      >
        ⋯
      </button>
      {menu}
    </div>
  );
}
