// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));
const pele = vi.hoisted(() => ({ renderAsync: vi.fn() }));
vi.mock("mermaid", () => ({ default: mermaid }));
vi.mock("pele/lazy", () => pele);

import { figureErrors } from "./figure-check";

beforeEach(() => {
  vi.clearAllMocks();
  mermaid.render.mockImplementation(async (_id: string, code: string) => {
    if (code.includes("A[bad")) throw new Error("Parse error on line 2");
    if (code.includes("empty")) return { svg: "" };
    return { svg: "<svg>m</svg>" };
  });
});

it("says why each diagram or chart that doesn't draw doesn't, and null for one that does", async () => {
  const errors = await figureErrors([
    { language: "mermaid", code: "flowchart TB\n  A --> B" },
    { language: "mermaid", code: "flowchart TB\n  A[bad" },
    { language: "mermaid", code: "flowchart TB\n  empty" },
    { language: "chart", code: '{"series": [{"data": [1, 2]}]}' },
    { language: "chart", code: '{"series": [{"data": ["12%"]}]}' },
  ]);
  expect(errors[0]).toBeNull();
  expect(errors[1]).toBe("Parse error on line 2");
  expect(errors[2]).toBe("it drew nothing");
  expect(errors[3]).toBeNull();
  expect(errors[4]).toMatch(/must be numbers/);
});

it("checks diagrams with Mermaid itself, whatever engine the user draws with", async () => {
  await figureErrors([
    { language: "mermaid", code: "flowchart TB\n  A --> B" },
  ]);
  expect(pele.renderAsync).not.toHaveBeenCalled();
  expect(mermaid.render).toHaveBeenCalledOnce();
});

it("leaves Mermaid's settings as the editor set them", async () => {
  await figureErrors([
    { language: "mermaid", code: "flowchart TB\n  A --> B" },
  ]);
  expect(mermaid.initialize).not.toHaveBeenCalled();
});
