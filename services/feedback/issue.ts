/**
 * A problem report sent from Help › Report a Problem, and the GitHub issue
 * made of it. Pure, so it can be tested without the Worker around it.
 */

export const KINDS = { bug: "bug", idea: "enhancement", question: "question" };
export const AREAS = [
  "editor",
  "ai",
  "plugins",
  "panes",
  "export",
  "files",
  "other",
] as const;
export const SEVERITIES = ["blocker", "major", "minor"] as const;

export interface Report {
  kind: keyof typeof KINDS;
  area: (typeof AREAS)[number];
  severity?: (typeof SEVERITIES)[number];
  description: string;
  details: string;
  contact?: string;
  version: string;
  language: string;
}

export interface Issue {
  title: string;
  body: string;
  labels: string[];
}

const LIMITS = { description: 5000, details: 20000, contact: 200, short: 100 };

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length <= max ? value.trim() : null;

/** The report in a request's body, or why it isn't one. */
export function readReport(raw: unknown): Report | string {
  if (!raw || typeof raw !== "object") return "not a report";
  const r = raw as Record<string, unknown>;
  if (typeof r.kind !== "string" || !(r.kind in KINDS)) return "kind";
  if (!AREAS.includes(r.area as Report["area"])) return "area";
  if (
    r.severity !== undefined &&
    !SEVERITIES.includes(r.severity as Report["severity"] & string)
  )
    return "severity";
  const description = text(r.description, LIMITS.description);
  if (!description || description.length < 5) return "description";
  const details = text(r.details ?? "", LIMITS.details);
  if (details === null) return "details";
  const contact = text(r.contact ?? "", LIMITS.contact);
  if (contact === null) return "contact";
  const version = text(r.version, LIMITS.short);
  const language = text(r.language, LIMITS.short);
  if (!version || !language) return "version";
  return {
    kind: r.kind as Report["kind"],
    area: r.area as Report["area"],
    severity: r.kind === "bug" ? (r.severity as Report["severity"]) : undefined,
    description,
    details,
    contact: contact || undefined,
    version,
    language,
  };
}

/** No one is pinged and no fence is closed by what the user typed. */
const quiet = (s: string) => s.replace(/@(?=\w)/g, "@​");
const fenced = (s: string) => s.replace(/`{3,}/g, "ʼʼʼ");

/** The issue for `report`; the contact never goes in it. */
export function issueFor(report: Report): Issue {
  const firstLine = report.description.split("\n")[0].trim();
  const title =
    firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
  const labels = [
    KINDS[report.kind],
    ...(report.area === "other" ? [] : [`area: ${report.area}`]),
    ...(report.severity ? [`severity: ${report.severity}`] : []),
    "from the app",
  ];
  const body = [
    quiet(report.description),
    "",
    "<details><summary>Textus</summary>",
    "",
    "```",
    fenced(quiet(report.details)),
    "```",
    "</details>",
    "",
    `_Sent from Textus ${report.version} (${report.language}) with Help › Report a Problem${report.contact ? "; the sender left a way to reach them, kept private" : ""}._`,
  ].join("\n");
  return { title, body, labels };
}
