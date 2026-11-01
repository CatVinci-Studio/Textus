// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../i18n/strings";
import type { Outline } from "../../platform/bindings/ai-paper";
import { OutlineCard } from "./OutlineCard";

const t = resolveStrings("en");
const outline: Outline = {
  thesis: "Green roofs cool cities.",
  sections: [
    {
      title: "Mechanism",
      keyPoints: ["Albedo", "Evapotranspiration"],
      evidence: ["n1"],
      targetWords: 600,
      figures: [{ kind: "mermaid", spec: "Heat flows on a roof" }],
    },
    {
      title: "Evidence",
      keyPoints: ["Measurements"],
      evidence: ["n2"],
      targetWords: 900,
      figures: [],
    },
  ],
};

afterEach(cleanup);

describe("OutlineCard", () => {
  it("shows the outline and hands on the user's edits on Approve", () => {
    const onApprove = vi.fn();
    render(
      <OutlineCard
        outline={outline}
        unit="words"
        busy={false}
        t={t}
        onApprove={onApprove}
      />,
    );
    expect(screen.getByText("About 1500 words in all")).toBeInTheDocument();
    // It reads as an outline: no fields until a part is opened.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Mechanism")).toBeInTheDocument();
    expect(screen.getByText("Heat flows on a roof")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit: Mechanism" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Section 1 title" }), {
      target: { value: "How it works" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));
    // The section moved, and is still the one open.
    expect(
      screen.getByRole("textbox", { name: "Section 2 title" }),
    ).toHaveValue("How it works");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve and write" }));
    const approved = onApprove.mock.calls[0][0] as Outline;
    expect(approved.sections.map((s) => s.title)).toEqual([
      "Evidence",
      "How it works",
    ]);
    expect(approved.sections[1].figures).toEqual([
      { kind: "mermaid", spec: "Heat flows on a roof" },
    ]);
  });

  it("can't be approved with an untitled section, nor edited while busy", () => {
    const { rerender } = render(
      <OutlineCard
        outline={outline}
        unit="words"
        busy={false}
        t={t}
        onApprove={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit: Evidence" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Section 2 title" }), {
      target: { value: " " },
    });
    expect(
      screen.getByRole("button", { name: "Approve and write" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
    rerender(
      <OutlineCard
        outline={outline}
        unit="words"
        busy
        t={t}
        onApprove={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Starting to write…" }),
    ).toBeDisabled();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit: Thesis" })).toBeDisabled();
  });

  it("shows two key points of a section, the rest on asking", () => {
    const many: Outline = {
      ...outline,
      sections: [
        { ...outline.sections[0], keyPoints: ["One", "Two", "Three", "Four"] },
      ],
    };
    render(
      <OutlineCard
        outline={many}
        unit="words"
        busy={false}
        t={t}
        onApprove={() => {}}
      />,
    );
    expect(screen.queryByText("Three")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2 more" }));
    expect(screen.getByText("Four")).toBeInTheDocument();
  });

  it("adds a section at the end and opens it", () => {
    const onApprove = vi.fn();
    render(
      <OutlineCard
        outline={outline}
        unit="words"
        busy={false}
        t={t}
        onApprove={onApprove}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add section/ }));
    expect(
      screen.getByRole("textbox", { name: "Section 3 title" }),
    ).toBeInTheDocument();
  });
});
