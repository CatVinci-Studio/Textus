// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const opened = vi.hoisted(() => [] as string[]);
const sent = vi.hoisted(() => [] as { description: string; details: string }[]);
vi.mock("../../platform/ipc", async (real) => ({
  ...(await real<object>()),
  links: { openWebLink: (url: string) => void opened.push(url) },
  systemIpc: {
    info: () =>
      Promise.resolve({ os: "Windows 11", arch: "x86_64", webview: "1" }),
    sendReport: (report: { description: string; details: string }) => {
      sent.push(report);
      return Promise.resolve({ url: "https://x/1", number: 1 });
    },
  },
}));

import { AppErrorBoundary, crashDetails } from "./AppErrorBoundary";
import { reportUrl } from "./report";

function Broken(): never {
  throw new Error("cannot read the panel");
}

const crash = async () => {
  render(
    <AppErrorBoundary>
      <Broken />
    </AppErrorBoundary>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Report a Problem" }));
  // The details, filled in once the system's facts are in.
  await waitFor(() =>
    expect(screen.getByText(/Crash: cannot read the panel/)).toBeVisible(),
  );
};

describe("AppErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    opened.length = 0;
    sent.length = 0;
  });
  afterEach(cleanup);

  it("says what broke, with a way back, instead of a blank window", () => {
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByText("cannot read the panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("sends the crash, with where it broke, without a word written", async () => {
    await crash();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.description).toBe("cannot read the panel");
    expect(sent[0]!.details).toContain("Stack:");
    // The component it broke in, from React.
    expect(sent[0]!.details).toMatch(/Components:\n.*Broken/);
  });

  it("or opens it in GitHub's form instead", async () => {
    await crash();
    fireEvent.click(screen.getByRole("button", { name: "Submit on GitHub" }));
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]!);
    expect(url.searchParams.get("description")).toContain(
      "Crash: cannot read the panel",
    );
    expect(url.searchParams.get("os-version")).toBe("Windows 11");
  });

  it("keeps each trace short", () => {
    const error = new Error("x");
    error.stack = Array.from({ length: 50 }, (_, i) => `at f${i}`).join("\n");
    const text = crashDetails(error, "\n  in A\n  in B");
    expect(text.split("\n").filter((l) => l.startsWith("at f"))).toHaveLength(
      12,
    );
    expect(text).toContain("Components:\nin A\nin B");
  });
});

describe("reportUrl", () => {
  it("leaves the details' last lines off an address too long for GitHub, never the crash", () => {
    const details = [
      "Crash: x",
      ...Array.from({ length: 900 }, (_, i) => `line ${i}`),
    ].join("\n");
    const facts = { os: "Windows 11", arch: "", webview: "", language: "en" };
    const url = reportUrl(facts, "it broke", details);
    expect(url.length).toBeLessThanOrEqual(7000);
    expect(new URL(url).searchParams.get("description")).toContain(
      "Crash: x\nline 0",
    );
  });
});
