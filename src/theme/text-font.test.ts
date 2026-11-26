// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { letterSpacing } from "./apply-appearance";
import { loadSettings } from "../prefs/SettingsContext";
import { installTestLocalStorage } from "../dev/test-local-storage";
import { fontChoices } from "../settings/sections/font-choices";
import { vi } from "vitest";
import {
  fontFaceCss,
  supplyFont,
  SUPPLIED_FONT_STYLE_ID,
  themeFontFaces,
} from "./supplied-font";

vi.mock("../platform/ipc", () => ({
  systemIpc: {
    fontFamilies: async () => [
      {
        name: "Inter",
        local: [],
        files: [{ path: "/f/Inter.otf", weight: 400, italic: false }],
      },
    ],
  },
}));
const fontList = async () =>
  (await import("../platform/ipc")).systemIpc.fontFamilies();
vi.mock("../platform/file-src", () => ({
  fileSrc: (path: string) => `asset://localhost${path}`,
}));

describe("text font and character spacing", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("sets character spacing the way Word does", () => {
    expect(letterSpacing("auto", 1)).toBeNull();
    expect(letterSpacing("normal", 3)).toBe("normal");
    expect(letterSpacing("expanded", 1.5)).toBe("1.5pt");
    expect(letterSpacing("condensed", 0.5)).toBe("-0.5pt");
  });

  it("keeps a stored spacing within Word's range and step", () => {
    const load = (by: unknown) => {
      localStorage.setItem(
        "catvinci-settings",
        JSON.stringify({
          docLetterSpacing: "expanded",
          docLetterSpacingBy: by,
        }),
      );
      return loadSettings();
    };
    expect(load(2.34).docLetterSpacingBy).toBe(2.3);
    expect(load(99).docLetterSpacingBy).toBe(10);
    expect(load(0).docLetterSpacingBy).toBe(0.1);
    expect(load("x").docLetterSpacingBy).toBe(1);
    expect(load(1).docLetterSpacing).toBe("expanded");
  });

  it("follows the theme until a font is chosen", () => {
    expect(loadSettings().docFont).toBe("");
    localStorage.setItem(
      "catvinci-settings",
      JSON.stringify({ docFont: " Songti SC " }),
    );
    expect(loadSettings().docFont).toBe("Songti SC");
  });

  it("offers well-made faces first, then every face the web view draws", () => {
    // The canvas: CJK faces draw everything, any other face Latin only;
    // "Hidden" is known to the web view by its Chinese name alone.
    const cjk = ["PingFang SC", "Songti SC", "微软雅黑", "隐藏"];
    let font = "";
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      set font(value: string) {
        font = value;
      },
      measureText: (text: string) => {
        const named = /"([^"]+)"/.exec(font)?.[1];
        const known =
          !!named && named !== "Hidden" && named !== "Microsoft YaHei";
        const own = known && (/^[ -~]+$/.test(text) || cjk.includes(named!));
        return { width: own ? 1 : 2 };
      },
    } as unknown as CanvasRenderingContext2D);
    const family = (name: string, zh?: string) => ({
      name,
      local: zh ? [{ language: "zh", name: zh }] : [],
      files: [],
    });
    const installed = [
      family("Georgia"),
      family("Hidden", "隐藏"),
      family("Microsoft YaHei", "微软雅黑"),
      family("PingFang SC", "苹方-简"),
      family("Zapfino"),
    ];
    const label = (c: { label: string }) => c.label;
    const zh = fontChoices(installed, "zh");
    expect(zh.recommended.map(label)).toEqual([
      "苹方-简 PingFang SC",
      "微软雅黑 Microsoft YaHei",
      "Georgia",
    ]);
    expect(zh.recommended[1].value).toBe("微软雅黑");
    expect(zh.more.map(label)).toEqual(["隐藏 Hidden", "Zapfino"]);
    const en = fontChoices(installed, "en");
    expect(en.recommended.map(label)).toEqual(["Georgia"]);
    expect(en.more.map(label)).toEqual([
      "Hidden",
      "Microsoft YaHei",
      "PingFang SC",
      "Zapfino",
    ]);
    vi.restoreAllMocks();
  });

  it("offers a font the web view can't find by name, served from its files", () => {
    // WKWebView finds no font the user installed: nothing draws by name.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: () => ({ width: 1 }),
    } as unknown as CanvasRenderingContext2D);
    const inter = {
      name: "Inter",
      local: [],
      files: [
        {
          path: "/Users/a/Library/Fonts/Inter-Bold.otf",
          weight: 700,
          italic: false,
        },
      ],
    };
    const unservable = { name: "Collected", local: [], files: [] };
    const en = fontChoices([inter, unservable], "en");
    expect(en.recommended).toEqual([{ value: "Inter", label: "Inter" }]);
    expect(en.more).toEqual([]);
    expect(fontFaceCss("Inter", inter)).toBe(
      '@font-face { font-family: "Inter"; ' +
        'src: url("asset://localhost/Users/a/Library/Fonts/Inter-Bold.otf"); ' +
        "font-weight: 700; font-style: normal; }",
    );
    vi.restoreAllMocks();
  });

  it("keeps serving the chosen font once the web view draws it", async () => {
    // The name draws only while its @font-face is in the page.
    const served = () => document.getElementById(SUPPLIED_FONT_STYLE_ID);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => {
        let font = "";
        return {
          set font(value: string) {
            font = value;
          },
          measureText: () => ({
            width: served() && font.includes('"Inter"') ? 2 : 1,
          }),
        } as unknown as CanvasRenderingContext2D;
      },
    );
    await supplyFont("Inter");
    expect(served()?.textContent).toContain("/f/Inter.otf");
    await supplyFont("Inter");
    expect(served()).not.toBeNull();
    await supplyFont("");
    expect(served()).toBeNull();
    vi.restoreAllMocks();
  });

  it("gives a theme the faces of the fonts drawn only from their files", async () => {
    // Georgia draws by name; Inter only from an @font-face once served.
    let served = false;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => {
        let font = "";
        return {
          set font(value: string) {
            font = value;
          },
          measureText: () => ({
            width:
              font.includes('"Georgia"') || (served && font.includes('"Inter"'))
                ? 2
                : 1,
          }),
        } as unknown as CanvasRenderingContext2D;
      },
    );
    const faces = await themeFontFaces(["Inter", "", "Georgia", "Inter"]);
    expect(faces).toBe(fontFaceCss("Inter", (await fontList())[0]));
    // Served already (the text font, a theme), it still needs its files.
    served = true;
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: [{ family: '"Inter"' }],
    });
    expect(await themeFontFaces(["Inter"])).toBe(faces);
    Reflect.deleteProperty(document, "fonts");
    expect(await themeFontFaces(["Inter"])).toBe("");
    vi.restoreAllMocks();
  });
});
