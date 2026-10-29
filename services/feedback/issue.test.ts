import { describe, expect, it } from "vitest";
import { issueFor, readReport, type Report } from "./issue";

const report = {
  kind: "bug",
  area: "panes",
  severity: "major",
  description: "Dropping a tab on the edge does nothing\nSteps: ...",
  details: "Textus 1.3.0-beta.6\nmacOS 26.1",
  contact: "me@example.com",
  version: "1.3.0-beta.6",
  language: "zh",
};

describe("a report from the app", () => {
  it("becomes an issue labelled by what it is about, without the contact", () => {
    const issue = issueFor(readReport(report) as Report);
    expect(issue.title).toBe("Dropping a tab on the edge does nothing");
    expect(issue.labels).toEqual([
      "bug",
      "area: panes",
      "severity: major",
      "from the app",
    ]);
    expect(issue.body).toContain("macOS 26.1");
    expect(issue.body).not.toContain("me@example.com");
  });

  it("pings no one and can't close its own code block", () => {
    const issue = issueFor(
      readReport({
        ...report,
        description: "ask @someone about it",
        details: "```\n</details>",
      }) as Report,
    );
    expect(issue.body).not.toContain("@someone");
    expect(issue.body.match(/```/g)).toHaveLength(2);
  });

  it("refuses what isn't one", () => {
    expect(readReport({ ...report, kind: "spam" })).toBe("kind");
    expect(readReport({ ...report, area: "x" })).toBe("area");
    expect(readReport({ ...report, description: "" })).toBe("description");
    expect(readReport({ ...report, contact: "x".repeat(300) })).toBe("contact");
    expect(
      issueFor(readReport({ ...report, area: "other" }) as Report).labels,
    ).not.toContain("area: other");
    // A severity belongs to a bug only.
    const idea = readReport({ ...report, kind: "idea" }) as Report;
    expect(idea.severity).toBeUndefined();
  });
});
