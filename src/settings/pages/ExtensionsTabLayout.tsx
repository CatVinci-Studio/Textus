import { useState, type ReactNode } from "react";
import type { Strings } from "../../i18n/strings";
import { RowHelp } from "../sections/controls";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";

export interface ExtensionsAction {
  label: string;
  onSelect: () => void;
}

/** One tab of Settings › Extensions: a line of what it holds, Get more (or
 *  `primary`) and other actions, the installed items, then Advanced, folded. */
export function ExtensionsTabLayout({
  t,
  intro,
  help,
  onGetMore,
  primary,
  actions = [],
  error,
  installedTitle,
  installed,
  advanced,
}: {
  t: Strings;
  intro: string;
  help?: ReactNode;
  onGetMore?: () => void;
  primary?: ExtensionsAction;
  actions?: ExtensionsAction[];
  error?: string | null;
  installedTitle: string;
  installed: ReactNode;
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
          {onGetMore && (
            <button
              type="button"
              className="text-button settings-inline-button extensions-get-more"
              onClick={onGetMore}
            >
              {t.marketGetMore}
            </button>
          )}
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
      <section className="settings-group" aria-label={installedTitle}>
        <h2 className="settings-group-title">{installedTitle}</h2>
        <div className="settings-group-body">{installed}</div>
      </section>
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
