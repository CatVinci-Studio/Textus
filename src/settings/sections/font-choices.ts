/**
 * The text fonts Settings offers: a short list of well-made faces first,
 * then the rest of what is installed. Recommended faces draw the
 * interface's language; the rest draw it or Latin text, since a Latin face
 * still serves a CJK document. A name the web view can't match changes
 * nothing, so it is left out, unless Textus serves it from its files.
 */

import { useEffect, useMemo, useState } from "react";
import type { FontFamily } from "../../platform/bindings/app";
import { draws, fontFamilies } from "../../theme/supplied-font";

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

/** One font in the list: the name it is set by, and the name shown,
 *  with its name in the interface's language first where it has one. */
interface FontChoice {
  value: string;
  label: string;
}

interface FontChoices {
  recommended: FontChoice[];
  more: FontChoice[];
}

/** The installed `families` for `language`, split as Settings lists them.
 *  Without a canvas (tests, an old engine) nothing is filtered. */
export function fontChoices(
  families: readonly FontFamily[],
  language: string,
): FontChoices {
  const script = scriptOf(language);
  const context = document.createElement("canvas").getContext("2d");
  const drawing = (family: string, ...samples: string[]) =>
    !context || samples.some((sample) => draws(context, family, sample));
  const choice = (family: FontFamily, ...samples: string[]) => {
    const local = family.local.find((l) => l.language === script)?.name;
    // The web view may know a face only by a localized name.
    const names = [family.name, ...family.local.map((l) => l.name)];
    // A face the web view doesn't know at all is served from its files.
    const unknown =
      family.files.length > 0 &&
      !names.some((name) => drawing(name, SAMPLES[script], SAMPLES.latin));
    const value = unknown
      ? family.name
      : names.find((name) => drawing(name, ...samples));
    if (!value) return [];
    return [{ value, label: local ? `${local} ${family.name}` : family.name }];
  };
  const installed = new Map(families.map((f) => [f.name.toLowerCase(), f]));
  const pick = (names: readonly string[], sample: string) =>
    names.flatMap((name) => {
      const family = installed.get(name.toLowerCase());
      return family ? choice(family, sample) : [];
    });
  const recommended = [
    ...(script === "latin" ? [] : pick(RECOMMENDED[script], SAMPLES[script])),
    ...pick(RECOMMENDED.latin, SAMPLES.latin),
  ].filter((c, i, all) => all.findIndex((o) => o.value === c.value) === i);
  const picked = new Set(recommended.map((c) => c.value));
  return {
    recommended,
    more: families
      .flatMap((family) => choice(family, SAMPLES[script], SAMPLES.latin))
      .filter((c) => !picked.has(c.value)),
  };
}

/** The installed text fonts as Settings offers them, once the list is in. */
export function useFontChoices(language: string): FontChoices {
  const [fonts, setFonts] = useState<FontFamily[]>([]);
  useEffect(() => {
    let live = true;
    void fontFamilies().then((list) => live && setFonts(list));
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => fontChoices(fonts, language), [fonts, language]);
}
