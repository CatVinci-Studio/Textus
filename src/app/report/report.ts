import { version as APP_VERSION } from "../../../package.json";
import { pluginsSnapshot } from "../../plugins/manager";
import { recentErrors } from "./recent-errors";

/** What a problem report says about this Textus, filled in for the user. */
export interface ReportFacts {
  os: string;
  arch: string;
  webview: string;
  language: string;
}

/** The facts as the lines a report carries: version, system, plugins and
 *  the errors met lately. */
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
    ...(errors.length ? ["Recent errors:", ...errors] : []),
  ].join("\n");
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
