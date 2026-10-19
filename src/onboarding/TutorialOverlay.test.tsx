// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TutorialOverlay, withCode } from "./TutorialOverlay";

afterEach(cleanup);

const labels = {
  collapse: "Minimize",
  expand: "Show instructions",
  back: "Back",
  skip: "Leave lesson",
  skipStep: "Skip this step",
  tryIt: "Try it",
  chapters: "Chapters",
  stepOfCount: "Step {i} of {n}",
};

const chapters = [
  { label: "Start", active: false, done: true },
  { label: "Writing", active: true, done: false },
  { label: "Done", active: false, done: false },
];

type Props = ComponentProps<typeof TutorialOverlay>;

function lesson(props: Partial<Props> = {}) {
  return render(
    <TutorialOverlay
      layout="card"
      stepId="wysiwyg"
      stepIndex={1}
      totalSteps={15}
      chapters={chapters}
      title="What you see is what you get"
      body="Markdown is formatted as you type."
      tasks={[
        { text: "A heading: `# Notes on Hamlet`, then Enter", done: true },
        { text: "A list: `- Hamlet`, Enter, `Horatio`", done: false },
      ]}
      primary={{ label: "Continue", onClick: vi.fn() }}
      onBack={vi.fn()}
      onSkip={vi.fn()}
      labels={labels}
      {...props}
    />,
  );
}

describe("TutorialOverlay", () => {
  it("labels and focuses an opening as an accessible dialog", () => {
    lesson({
      layout: "overlay",
      stepId: "welcome",
      stepIndex: 0,
      title: "Welcome",
      tasks: undefined,
      primary: { label: "Start", onClick: vi.fn() },
    });
    expect(screen.getByRole("dialog", { name: "Welcome" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
    expect(screen.getByRole("button", { name: "Start" })).toHaveFocus();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
  });

  it("is a title, one sentence, the things to do and the animation", () => {
    const onWatch = vi.fn();
    lesson({ watch: { label: "Watch the animation", onClick: onWatch } });
    const dialog = screen.getByRole("dialog", {
      name: "What you see is what you get",
    });
    expect(dialog).toHaveTextContent("Markdown is formatted as you type.");
    // What to type is set as code.
    expect(screen.getByText("# Notes on Hamlet").tagName).toBe("CODE");
    expect(screen.getByText("Horatio").tagName).toBe("CODE");
    expect(screen.getByText("Step 2 of 15")).toBeVisible();
    expect(screen.getByText("Writing")).toHaveAttribute("aria-current", "step");
    fireEvent.click(
      screen.getByRole("button", { name: /Watch the animation/ }),
    );
    expect(onWatch).toHaveBeenCalledOnce();
  });

  it("keeps Continue disabled until the lesson is done, with a way past", () => {
    const onPrimary = vi.fn();
    const onSkipStep = vi.fn();
    lesson({
      primary: { label: "Continue", onClick: onPrimary, disabled: true },
      onSkipStep,
    });
    const next = screen.getByRole("button", { name: "Continue" });
    expect(next).toBeDisabled();
    fireEvent.click(next);
    expect(onPrimary).not.toHaveBeenCalled();
    // A misfiring exercise must never leave "exit the whole guide" as the
    // only way forward.
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    expect(onSkipStep).toHaveBeenCalledOnce();
  });

  it("ticks each line once it is done", () => {
    lesson();
    const lines = screen
      .getByRole("region", { name: "Try it" })
      .querySelectorAll(".tutorial-task-line");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveClass("is-complete");
    expect(lines[1]).not.toHaveClass("is-complete");
    expect(lines[1]).toHaveTextContent(/^2/);
  });

  it("shows a note and the animation as extras, Continue as the way on", () => {
    const onWatch = vi.fn();
    const onNext = vi.fn();
    lesson({
      stepId: "grammar",
      primary: { label: "Continue", onClick: onNext },
      watch: { label: "Watch the animation", onClick: onWatch },
      note: "Connect an AI later in Settings › Textus AI to try it yourself.",
    });
    expect(screen.getByText(/Connect an AI later/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Watch the animation/ }),
    );
    expect(onNext).toHaveBeenCalledOnce();
    expect(onWatch).toHaveBeenCalledOnce();
  });

  it("does not exit the whole guide when Escape is pressed on a lesson", () => {
    const onSkip = vi.fn();
    lesson({ onSkip });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onSkip).not.toHaveBeenCalled();
  });

  it("can minimize a lesson without hiding navigation", () => {
    lesson();
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(screen.getByText("# Notes on Hamlet")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Continue" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show instructions" }));
    expect(screen.getByText("# Notes on Hamlet")).toBeVisible();
  });

  it("keeps Tab inside an overlay and closes it with Escape", () => {
    const onSkip = vi.fn();
    lesson({
      layout: "overlay",
      stepId: "welcome",
      stepIndex: 0,
      title: "Welcome",
      primary: { label: "Start", onClick: vi.fn() },
      onSkip,
    });
    fireEvent.keyDown(screen.getByRole("button", { name: "Start" }), {
      key: "Tab",
    });
    expect(screen.getByRole("button", { name: "Leave lesson" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

describe("withCode", () => {
  const parts = (text: string) =>
    withCode(text).map((part) =>
      typeof part === "string"
        ? part
        : `<${(part as { props: { children: string } }).props.children}>`,
    );

  it("sets backtick spans as code, the rest as text", () => {
    expect(parts("Type `# Notes`, then Enter")).toEqual([
      "Type ",
      "<# Notes>",
      ", then Enter",
    ]);
  });

  it("lets a longer run hold backticks, as Markdown does", () => {
    expect(parts("Code: ``Read `Act I` again.``")).toEqual([
      "Code: ",
      "<Read `Act I` again.>",
    ]);
    expect(parts("A diagram: ```` ```mermaid ````, Enter")).toEqual([
      "A diagram: ",
      "<```mermaid>",
      ", Enter",
    ]);
    expect(parts("代码：`` `第三回` 值得重读。 ``")).toEqual([
      "代码：",
      "<`第三回` 值得重读。>",
    ]);
  });

  it("leaves an unclosed backtick as text", () => {
    expect(parts("a ` b")).toEqual(["a ` b"]);
  });
});
