import { describe, expect, it } from "vitest";
import { skillsInReply } from "./chat-skill";

const file = [
  "---",
  "name: weekly-report",
  "description: >-",
  "  Turns the week's notes into the team's weekly report.",
  "  Use when asked for a weekly report.",
  "metadata:",
  '  textus-version: "1.0.0"',
  '  textus-modes: "write review"',
  '  textus-label-zh: "写周报"',
  "---",
  "",
  "Turn the notes into a report: done, next, blocked.",
].join("\n");

const reply = [
  "A skill for your weekly report - call it with /weekly-report.",
  "",
  "```markdown weekly-report.md",
  file,
  "```",
  "",
  "```markdown",
  "# not a file",
  "```",
].join("\n");

describe("a skill in a reply", () => {
  it("is its file, name, modes and names", () => {
    const [skill, ...rest] = skillsInReply(reply);
    expect(rest).toEqual([]);
    expect(skill).toMatchObject({
      name: "weekly-report",
      description:
        "Turns the week's notes into the team's weekly report. Use when asked for a weekly report.",
      labels: { zh: "写周报" },
      modes: ["write", "review"],
    });
    expect(skill.text).toBe(`${file}\n`);
  });

  it("is in Write when it doesn't say", () => {
    const [skill] = skillsInReply(reply.replace(/ {2}textus-modes.*\n/, ""));
    expect(skill.modes).toEqual(["write"]);
  });

  it("is nothing without front matter or instructions", () => {
    // A plugin's README.md is a guide, not a skill.
    expect(skillsInReply("```markdown README.md\n# Guide\n```")).toEqual([]);
    expect(skillsInReply("```markdown x.md\n---\nname: x\n---\n\n```")).toEqual(
      [],
    );
  });
});
