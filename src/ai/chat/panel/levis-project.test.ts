import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../../i18n/strings";

const showConfirm = vi.fn();
const showMessage = vi.fn();
const convertLevisProject = vi.fn();
const uiState: Record<string, unknown> = {};

vi.mock("../../../ui/app-dialog", () => ({
  showConfirm: (...args: unknown[]) => showConfirm(...args),
  showMessage: (...args: unknown[]) => showMessage(...args),
}));
vi.mock("../../../platform/ipc", () => ({
  ai: {
    convertLevisProject: (...args: unknown[]) => convertLevisProject(...args),
  },
}));
vi.mock("../../../storage/ui-state", () => ({
  getUiState: (key: string) => uiState[key],
  setUiState: (key: string, value: unknown) => {
    uiState[key] = value;
  },
}));

const { offerLevisConversion, resetLevisOffersForTests } =
  await import("./levis-project");

const t = resolveStrings("zh");

afterEach(() => {
  vi.clearAllMocks();
  resetLevisOffersForTests();
  delete uiState.levisProjectsDeclined;
});

describe("the Levis project offer", () => {
  it("asks in the owner's words and converts on Convert", async () => {
    showConfirm.mockResolvedValue(true);
    convertLevisProject.mockResolvedValue(4);
    expect(await offerLevisConversion(t, "/novel", "/novel/a.md", null)).toBe(
      true,
    );
    expect(showConfirm.mock.calls[0][0]).toBe(
      "发现 Levis 的项目资料（文风、资料库、写作要求、技能），要转成 Textus 的格式吗？",
    );
    expect(showConfirm.mock.calls[0][1]).toMatchObject({
      okLabel: "转换",
      cancelLabel: "以后再说",
    });
    expect(convertLevisProject).toHaveBeenCalledWith("/novel/a.md", null);
    expect(showMessage.mock.calls[0][0]).toContain("4 个文件");
  });

  it("asks once per project in a session", async () => {
    showConfirm.mockResolvedValue(true);
    convertLevisProject.mockResolvedValue(1);
    await offerLevisConversion(t, "/novel", null, null);
    await offerLevisConversion(t, "/novel", null, null);
    expect(showConfirm).toHaveBeenCalledTimes(1);
  });

  it("remembers Not now per project, across sessions", async () => {
    showConfirm.mockResolvedValue(false);
    expect(await offerLevisConversion(t, "/novel", null, null)).toBe(false);
    expect(uiState.levisProjectsDeclined).toEqual(["/novel"]);
    expect(convertLevisProject).not.toHaveBeenCalled();
    resetLevisOffersForTests(); // a new session
    await offerLevisConversion(t, "/novel", null, null);
    expect(showConfirm).toHaveBeenCalledTimes(1);
    // Another project is still asked about.
    await offerLevisConversion(t, "/essays", null, null);
    expect(showConfirm).toHaveBeenCalledTimes(2);
  });
});
