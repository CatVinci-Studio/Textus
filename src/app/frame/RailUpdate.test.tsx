// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../i18n/strings";

const update = vi.hoisted(() => ({
  state: { status: "idle", version: null, error: null, selfUpdate: true } as {
    status: string;
    version: string | null;
    error: string | null;
    selfUpdate: boolean;
  },
  install: vi.fn(async () => {}),
}));
const emit = vi.hoisted(() => vi.fn());
vi.mock("../app-update", () => ({
  useAppUpdate: () => update.state,
  installUpdate: update.install,
}));
vi.mock("../../platform/menu-events", () => ({ emitToThisWindow: emit }));

const { RailUpdate } = await import("./RailUpdate");
const t = resolveStrings("en");

afterEach(cleanup);

describe("the rail's update mark", () => {
  it("is there only while a release waits, and a click installs it", () => {
    const { rerender } = render(<RailUpdate t={t} />);
    expect(screen.queryByRole("button")).toBeNull();
    update.state = { ...update.state, status: "available", version: "1.4.0" };
    rerender(<RailUpdate t={t} />);
    const button = screen.getByRole("button");
    expect(button).toHaveAccessibleName(expect.stringContaining("1.4.0"));
    fireEvent.click(button);
    expect(update.install).toHaveBeenCalled();
  });

  it("sends a package manager's build to its page instead", () => {
    update.state = { ...update.state, status: "available", selfUpdate: false };
    render(<RailUpdate t={t} />);
    fireEvent.click(screen.getByRole("button"));
    expect(emit).toHaveBeenCalledWith("menu-check-updates");
  });

  it("waits while it downloads, and says why it failed", () => {
    update.state = { ...update.state, status: "downloading", selfUpdate: true };
    const { rerender } = render(<RailUpdate t={t} />);
    expect(screen.getByRole("button")).toBeDisabled();
    update.state = { ...update.state, status: "error", error: "no disk" };
    rerender(<RailUpdate t={t} />);
    expect(screen.getByRole("button")).toHaveAccessibleName(
      expect.stringContaining("no disk"),
    );
  });
});
