// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const opened = vi.hoisted(() => [] as string[]);
vi.mock("../../platform/ipc", () => ({
  links: { openWebLink: (url: string) => void opened.push(url) },
  systemIpc: {
    info: () =>
      Promise.resolve({ os: "Windows 11", arch: "x86_64", webview: "1" }),
  },
}));

import { AppErrorBoundary, crashDetails } from "./AppErrorBoundary";

function Broken(): never {
  throw new Error("cannot read the panel");
}

describe("AppErrorBoundary", () => {
  afterEach(cleanup);

  it("says what broke, with a way back, instead of a blank window", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByText("cannot read the panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("reports the crash as an issue that says where it broke", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Report a Problem" }));
    await waitFor(() => expect(opened).toHaveLength(1));
    const url = new URL(opened[0]!);
    expect(url.pathname).toBe("/CatVinci-Studio/Textus/issues/new");
    const body = url.searchParams.get("description")!;
    expect(body).toContain("Crash: cannot read the panel");
    expect(body).toContain("Stack:");
    // The component it broke in, from React.
    expect(body).toMatch(/Components:\n.*Broken/);
    expect(url.searchParams.get("os-version")).toBe("Windows 11");
  });

  it("keeps each trace short enough for the form's address", () => {
    const error = new Error("x");
    error.stack = Array.from({ length: 50 }, (_, i) => `at f${i}`).join("\n");
    const text = crashDetails(error, "\n  in A\n  in B");
    expect(text.split("\n").filter((l) => l.startsWith("at f"))).toHaveLength(
      12,
    );
    expect(text).toContain("Components:\nin A\nin B");
  });
});
