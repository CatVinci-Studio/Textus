import type { ReactNode } from "react";
import { fill } from "../../i18n/fill";
import type { Strings } from "../../i18n/strings";

type DataAttrs = { [key: `data-${string}`]: string | undefined };

/**
 * One thing in a list of add-ons (a plugin, a skill, a theme's maker, a
 * tool server): its icon, name, line and byline, opening its page when it
 * has one; its button beside it. `extra` sits under the byline (a server's
 * state and tools).
 */
export function CatalogRow({
  name,
  description,
  descriptionClass,
  icon,
  byline,
  status,
  openLabel,
  onOpen,
  action,
  actionClass,
  off,
  extra,
  className,
  ...data
}: {
  name: ReactNode;
  description?: ReactNode;
  descriptionClass?: string;
  icon?: ReactNode;
  byline?: ReactNode;
  /** Something wrong with it, in the error colour. */
  status?: ReactNode;
  openLabel?: string;
  onOpen?: () => void;
  action?: ReactNode;
  actionClass?: string;
  /** Turned off: its words and icon quieter. */
  off?: boolean;
  extra?: ReactNode;
  className?: string;
} & DataAttrs) {
  const words = (
    <>
      <span className="settings-row-label plugin-card-name">{name}</span>
      {description && (
        <span
          className={`settings-row-hint tx-clamp plugin-card-description${descriptionClass ? ` ${descriptionClass}` : ""}`}
        >
          {description}
        </span>
      )}
      {byline}
      {status && <span className="settings-error">{status}</span>}
      {extra}
    </>
  );
  const body = icon ? (
    <>
      {icon}
      <span className="plugin-card-text">{words}</span>
    </>
  ) : (
    words
  );
  const openClass = `plugin-card-open${icon ? " plugin-card-with-icon" : ""}`;
  return (
    <div
      className={["settings-row plugin-card", off && "is-off", className]
        .filter(Boolean)
        .join(" ")}
      {...data}
    >
      {onOpen ? (
        <button
          type="button"
          className={openClass}
          aria-label={openLabel}
          onClick={onOpen}
        >
          {body}
        </button>
      ) : (
        <div className={openClass}>{body}</div>
      )}
      {action && (
        <div
          className={`settings-row-control${actionClass ? ` ${actionClass}` : ""}`}
        >
          {action}
        </div>
      )}
    </div>
  );
}

/**
 * Who made it, in one order everywhere: what it is for (`lead`), Official,
 * made by Textus AI, the maker, its version, how often it was installed,
 * then anything else.
 */
export function Byline({
  t,
  lead,
  official,
  madeHere,
  author,
  version,
  dev,
  installs,
  children,
}: {
  t: Strings;
  lead?: ReactNode;
  official?: boolean;
  madeHere?: boolean;
  author?: string;
  version?: string;
  /** Loaded from a folder on this computer. */
  dev?: boolean;
  installs?: string | null;
  children?: ReactNode;
}) {
  return (
    <span className="plugin-byline">
      {lead}
      {official && (
        <span className="tx-badge" data-tone="strong">
          {t.pluginOfficial}
        </span>
      )}
      {madeHere && (
        <span className="tx-badge" data-tone="strong">
          {t.madeByTextusAi}
        </span>
      )}
      {author && <span>{fill(t.pluginBy, { author })}</span>}
      {version && (
        <span className="plugin-version" data-search-ignore>
          {version}
          {dev ? ` · ${t.pluginDevTag}` : ""}
        </span>
      )}
      {installs && <span className="plugin-installs">{installs}</span>}
      {children}
    </span>
  );
}
