import type { ReactNode } from "react";

/**
 * A section of a Settings page (and of a plugin's page): a small heading,
 * what acts on the whole section at its end (add, import, ⋯), then one flat
 * list of rows. The one box on the page: nothing inside it draws another.
 */
export function SettingsGroup({
  title,
  actions,
  children,
}: {
  /** None for a page's first section when it would only repeat the page's
   *  own name. */
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-group" aria-label={title}>
      {(title || actions) && (
        <div className="settings-group-head">
          {title && <h2 className="settings-group-title">{title}</h2>}
          {actions && <div className="settings-group-actions">{actions}</div>}
        </div>
      )}
      <div className="settings-group-body">{children}</div>
    </section>
  );
}
