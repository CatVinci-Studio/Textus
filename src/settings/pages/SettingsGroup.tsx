import type { ReactNode } from "react";

export function SettingsGroup({
  title,
  children,
}: {
  /** None for a page's first group when it would only repeat the page's
   *  own title. */
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-group" aria-label={title}>
      {title && <h2 className="settings-group-title">{title}</h2>}
      <div className="settings-group-body">{children}</div>
    </section>
  );
}
