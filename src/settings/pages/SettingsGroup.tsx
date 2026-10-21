import type { ReactNode } from "react";

/** A titled group of rows on a Settings page. */
export function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-group">
      <h2 className="settings-group-title">{title}</h2>
      <div className="settings-group-body">{children}</div>
    </section>
  );
}
