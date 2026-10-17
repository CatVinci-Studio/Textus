// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../i18n/strings";
import { DiaryLeaveButton } from "./DiaryLeaveButton";

const mock = vi.hoisted(() => ({
  setSettings: vi.fn(),
  settings: { enableDiary: true },
}));
vi.mock("../../settings/SettingsContext", () => ({ useSettings: () => mock }));

const t = resolveStrings("en");
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("DiaryLeaveButton", () => {
  it("is there, named, while the diary is open", () => {
    mock.settings = { enableDiary: true };
    render(<DiaryLeaveButton t={t} />);
    const button = screen.getByRole("button", { name: "Leave the diary" });
    expect(button).toHaveAttribute("title", "Leave the diary");
  });

  it("closes the diary the way the five taps do", () => {
    mock.settings = { enableDiary: true };
    render(<DiaryLeaveButton t={t} />);
    fireEvent.click(screen.getByRole("button", { name: "Leave the diary" }));
    expect(mock.setSettings).toHaveBeenCalledWith({ enableDiary: false });
  });

  it("is absent while the diary is closed", () => {
    mock.settings = { enableDiary: false };
    render(<DiaryLeaveButton t={t} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("speaks Chinese as 退出日记", () => {
    mock.settings = { enableDiary: true };
    render(<DiaryLeaveButton t={resolveStrings("zh")} />);
    expect(screen.getByRole("button", { name: "退出日记" })).toBeVisible();
  });
});
