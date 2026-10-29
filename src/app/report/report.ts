import { version as APP_VERSION } from "../../../package.json";
import { pluginsSnapshot } from "../../plugins/manager";
import type { Settings } from "../../prefs/settings-types";
import { recentErrors } from "./recent-errors";

/** What a problem report says about this Textus, filled in for the user. */
export interface ReportFacts {
  os: string;
  arch: string;
  webview: string;
  language: string;
  settings?: Settings;
}

/** Settings that may name the user's places, servers or own words. */
const PRIVATE =
  /endpoint|url|host|port|folder|root|path|css|conventions|field|plugins|models|shortcuts/i;

/** The settings with nothing private in them: switches, numbers and short
 *  choices; a list by its length. */
export function settingsSummary(settings: Settings): string {
  return Object.entries(settings)
    .filter(([key]) => !PRIVATE.test(key))
    .flatMap(([key, value]) => {
      if (typeof value === "boolean" || typeof value === "number")
        return [`${key}=${value}`];
      if (typeof value === "string" && /^[\w.-]{1,24}$/.test(value))
        return [`${key}=${value}`];
      if (Array.isArray(value)) return [`${key}=[${value.length}]`];
      return [];
    })
    .join(", ");
}

/** The facts as the lines a report carries: version, system, plugins,
 *  settings and the errors met lately. */
export function reportDetails(facts: ReportFacts): string {
  const plugins = pluginsSnapshot().records.map(
    (r) => `${r.id} ${r.manifest?.version ?? "?"} (${r.status})`,
  );
  const errors = recentErrors();
  return [
    `Textus ${APP_VERSION}`,
    `${facts.os} ${facts.arch}`,
    `WebView ${facts.webview || "?"}`,
    `Language ${facts.language}`,
    `Plugins: ${plugins.length ? plugins.join(", ") : "none"}`,
    ...(facts.settings ? [`Settings: ${settingsSummary(facts.settings)}`] : []),
    ...(errors.length ? ["Recent errors:", ...errors] : []),
  ].join("\n");
}

/** What a report is, what it is about and, for a bug, how bad it is: the
 *  labels its issue gets (services/feedback/issue.ts). */
export const REPORT_KINDS = ["bug", "idea", "question"] as const;
export const REPORT_AREAS = [
  "editor",
  "ai",
  "plugins",
  "panes",
  "export",
  "files",
  "other",
] as const;
export const REPORT_SEVERITIES = ["blocker", "major", "minor"] as const;

export interface ReportChoice {
  kind: (typeof REPORT_KINDS)[number];
  area: (typeof REPORT_AREAS)[number];
  severity: (typeof REPORT_SEVERITIES)[number];
}

/** What is sent to be filed: a severity only for a bug, a contact only
 *  when one was given. */
export function reportPayload(
  facts: ReportFacts,
  choice: ReportChoice,
  description: string,
  details: string,
  contact: string,
) {
  return {
    kind: choice.kind,
    area: choice.area,
    severity: choice.kind === "bug" ? choice.severity : null,
    description: description.trim(),
    details,
    contact: contact.trim() || null,
    version: APP_VERSION,
    language: facts.language,
  };
}

/** The bug report form on GitHub, its fields filled: what the user wrote
 *  and the details, the system and the version. */
export function reportUrl(
  facts: ReportFacts,
  description: string,
  details: string,
): string {
  const chinese = facts.language.startsWith("zh");
  const platform = facts.os.startsWith("macOS")
    ? "macOS"
    : facts.os.startsWith("Windows")
      ? "Windows"
      : facts.os.startsWith("iOS")
        ? "iPhone / iPad"
        : "";
  const params = new URLSearchParams({
    template: chinese ? "2-bug-report-zh.yml" : "1-bug-report.yml",
    description: `${description.trim()}\n\n<details><summary>Textus</summary>\n\n\`\`\`\n${details}\n\`\`\`\n</details>`,
    "os-version": facts.os,
    "app-version": APP_VERSION,
    ...(platform ? { platform } : {}),
  });
  return `https://github.com/CatVinci-Studio/Textus/issues/new?${params}`;
}
