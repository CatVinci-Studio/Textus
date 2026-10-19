import { describe, expect, it } from "vitest";
import { parseProposal, resolveSkillMessage } from "./proposal";

const skills = [
  { name: "tighten", description: "Tighten prose", prompt: "Cut filler." },
];

describe("resolveSkillMessage", () => {
  it("expands /name into the skill's prompt, marked as already loaded", () => {
    expect(resolveSkillMessage("/tighten the Method paragraph", skills)).toBe(
      '<skill name="tighten">\nCut filler.\n</skill>\n\nthe Method paragraph',
    );
    expect(resolveSkillMessage("/tighten", skills)).toBe(
      '<skill name="tighten">\nCut filler.\n</skill>',
    );
  });

  it("leaves other messages alone", () => {
    expect(resolveSkillMessage("/unknown thing", skills)).toBe(
      "/unknown thing",
    );
    expect(resolveSkillMessage("tighten this", skills)).toBe("tighten this");
  });

  it("accepts the slash a Chinese IME types, and aliases", () => {
    const resolve = (token: string) => (token === "精简" ? "tighten" : null);
    expect(resolveSkillMessage("／tighten 第二段", skills)).toBe(
      '<skill name="tighten">\nCut filler.\n</skill>\n\n第二段',
    );
    expect(resolveSkillMessage("、精简 第二段", skills, resolve)).toBe(
      '<skill name="tighten" typed="/精简">\nCut filler.\n</skill>\n\n第二段',
    );
    // A built-in the workspace has no prompt for: the backend expands it.
    expect(
      resolveSkillMessage("/续写", skills, (t) =>
        t === "续写" ? "continue-story" : null,
      ),
    ).toBe('<skill name="continue-story" typed="/续写"></skill>');
    // An unknown word after 、 is just a sentence.
    expect(resolveSkillMessage("、然后", skills, resolve)).toBe("、然后");
  });
});

describe("parseProposal", () => {
  it("writes the reply's LaTeX maths in dollars", () => {
    const proposal = parseProposal(
      JSON.stringify({ action: "append", text: "so \\(x\\) and\n\\[y\\]" }),
    );
    expect(proposal?.text).toBe("so $x$ and\n$$\ny\n$$");
  });
});
