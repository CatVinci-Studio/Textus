/**
 * The text fonts Settings offers: a short list of well-made faces first,
 * then the rest of what is installed. Only faces that draw the interface's
 * language: a Korean face picked for Chinese text changes nothing, and a
 * name the web view can't match changes nothing either.
 */

/** Faces the large platforms and type foundries ship for reading, by the
 *  script they are for; the first installed ones are offered first. */
const RECOMMENDED: Record<string, readonly string[]> = {
  latin: [
    "Inter",
    "SF Pro Text",
    "Helvetica Neue",
    "Avenir Next",
    "Segoe UI",
    "Source Sans 3",
    "Charter",
    "Iowan Old Style",
    "Georgia",
    "Palatino",
    "Source Serif 4",
    "Literata",
  ],
  zh: [
    "PingFang SC",
    "HarmonyOS Sans SC",
    "MiSans",
    "Source Han Sans SC",
    "Noto Sans CJK SC",
    "Microsoft YaHei",
    "Songti SC",
    "Source Han Serif SC",
    "Noto Serif CJK SC",
    "LXGW WenKai",
    "Kaiti SC",
  ],
  "zh-Hant": [
    "PingFang TC",
    "Source Han Sans TC",
    "Noto Sans CJK TC",
    "Microsoft JhengHei",
    "Songti TC",
    "Source Han Serif TC",
    "Noto Serif CJK TC",
    "LXGW WenKai TC",
  ],
  ja: [
    "Hiragino Sans",
    "Source Han Sans JP",
    "Noto Sans CJK JP",
    "Yu Gothic",
    "Hiragino Mincho ProN",
    "Source Han Serif JP",
    "Noto Serif CJK JP",
    "Yu Mincho",
  ],
  ko: [
    "Apple SD Gothic Neo",
    "Pretendard",
    "Source Han Sans KR",
    "Noto Sans CJK KR",
    "Malgun Gothic",
    "Source Han Serif KR",
    "Noto Serif CJK KR",
  ],
};

/** A line in the language, which a face must draw itself. */
const SAMPLES: Record<string, string> = {
  latin: "Handgloves 0123",
  zh: "永和九年岁在癸丑",
  "zh-Hant": "永和九年歲在癸丑",
  ja: "いろはにほへと漢字",
  ko: "다람쥐 헌 쳇바퀴",
};

function scriptOf(language: string): string {
  if (/^zh-(Hant|TW|HK|MO)/i.test(language)) return "zh-Hant";
  const base = language.split("-")[0];
  return base in SAMPLES ? base : "latin";
}

/** Whether `family` draws `sample` itself: its width differs from both
 *  generic fallbacks' when it does. */
function draws(
  context: CanvasRenderingContext2D,
  family: string,
  sample: string,
): boolean {
  return ["monospace", "serif"].some((fallback) => {
    context.font = `32px ${fallback}`;
    const alone = context.measureText(sample).width;
    context.font = `32px "${family.replace(/"/g, "")}", ${fallback}`;
    return context.measureText(sample).width !== alone;
  });
}

interface FontChoices {
  recommended: string[];
  more: string[];
}

/** The installed `families` for `language`, split as Settings lists them.
 *  Without a canvas (tests, an old engine) nothing is filtered. */
export function fontChoices(
  families: readonly string[],
  language: string,
): FontChoices {
  const script = scriptOf(language);
  const context = document.createElement("canvas").getContext("2d");
  const drawing = (sample: string) => (family: string) =>
    !context || draws(context, family, sample);
  const installed = new Map(families.map((f) => [f.toLowerCase(), f]));
  const pick = (names: readonly string[], sample: string) =>
    names
      .flatMap((name) => installed.get(name.toLowerCase()) ?? [])
      .filter(drawing(sample));
  // Latin faces still serve a CJK document: its own face follows for the
  // rest (--doc-chosen-font).
  const recommended = [
    ...new Set([
      ...(script === "latin" ? [] : pick(RECOMMENDED[script], SAMPLES[script])),
      ...pick(RECOMMENDED.latin, SAMPLES.latin),
    ]),
  ];
  const picked = new Set(recommended);
  return {
    recommended,
    more: families
      .filter((family) => !picked.has(family))
      .filter(drawing(SAMPLES[script])),
  };
}
