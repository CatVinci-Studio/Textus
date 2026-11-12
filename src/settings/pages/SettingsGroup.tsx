import type { ReactNode } from "react";

/**
 * A section of a Settings page (and of a plugin's page): a small heading,
 * what acts on the whole section at its end (add, import, ⋯), then one flat
 * list of rows. The one box on the page: nothing inside it draws another.
 */
export function SettingsGroup({
  title,
  count,
  actions,
  className,
  children,
}: {
  /** None for a page's first section when it would only repeat the page's
   *  own name. */
  title?: string;
  /** How many it lists, after the title. */
  count?: number;
  actions?: ReactNode;
  className?: string;
  /** None while the section is folded: only its head shows. */
  children?: ReactNode;
}) {
  return (
    <section
      className={className ? `settings-group ${className}` : "settings-group"}
      aria-label={title}
    >
      {(title || actions) && (
        <div className="settings-group-head">
          {title && (
            <h2 className="settings-group-title">
              {title}
              {count !== undefined && (
                <span className="settings-group-count" data-search-ignore>
                  {count}
                </span>
              )}
            </h2>
          )}
          {actions && <div className="settings-group-actions">{actions}</div>}
        </div>
      )}
      {children && <div className="settings-group-body">{children}</div>}
    </section>
  );
}
