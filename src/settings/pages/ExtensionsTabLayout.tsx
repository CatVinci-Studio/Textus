import { useState, type ReactNode } from "react";
import type { Strings } from "../../i18n/strings";
import { RowHelp } from "../sections/controls";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";

export interface ExtensionsAction {
  label: string;
  onSelect: () => void;
}

/** One tab of Settings › Extensions: a line of what it holds and its
 *  actions, `top` (a switch over all of them), one search over both lists,
 *  what is installed, what is available, then Advanced, folded. */
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
  installed,
  available,
  footer,
  advanced,
}: {
  t: Strings;
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
  installed: ReactNode;
  available?: ReactNode;
  footer?: ReactNode;
  advanced?: ReactNode;
}) {
  return (
    <>
      <div className="extensions-head">
        <p className="extensions-intro">
          {intro}
          {help && <RowHelp label={intro}>{help}</RowHelp>}
        </p>
        <div className="extensions-head-actions">
          {actions.length > 0 && <MoreMenu t={t} actions={actions} />}
          {primary && (
            <button
              type="button"
              className="text-button settings-inline-button extensions-get-more"
              onClick={primary.onSelect}
            >
              {primary.label}
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
      {top}
      <div className={off ? "extensions-off" : undefined}>
        {onQuery && (
          <input
            type="search"
            className="plugin-search"
            placeholder={t.marketSearch}
            aria-label={t.marketSearch}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        )}
        <section className="settings-group" aria-label={installedTitle}>
          <h2 className="settings-group-title">
            {installedTitle}
            {!!installedCount && (
              <span className="extensions-count">{installedCount}</span>
            )}
          </h2>
          <div className="settings-group-body">{installed}</div>
        </section>
        {available}
        {footer}
      </div>
      {advanced && (
        <details className="settings-advanced extensions-advanced">
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
  const [open, setOpen] = useState(false);
  const ref = useCloseOnOutsideClick<HTMLDivElement>(
    () => setOpen(false),
    true,
    open,
  );
  return (
    <div className="extensions-more" ref={ref}>
      <button
        type="button"
        className="text-button settings-inline-button extensions-more-button"
        aria-label={t.toolbarMore}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="extensions-more-menu floating-surface" role="menu">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className="context-menu-item"
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
