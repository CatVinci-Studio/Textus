import { localeOf, type Lang, type Strings } from "../i18n/strings";

/**
 * Writing conventions: which house rules the AI and checks follow for
 * punctuation, spacing, numbers and form. The values are machine-read, so
 * they never change; only their names are localised.
 */

export const AUTOMATIC_CONVENTIONS = "automatic";

/** The profiles, by document language, in the order the picker lists them. */
export const CONVENTION_PROFILES: { language: string; profiles: string[] }[] = [
  {
    language: "zh-Hans",
    profiles: [
      "zh-Hans-CN",
      "zh-Hans-CN/tech",
      "zh-Hans-CN/gongwen",
      "zh-Hans-CN/academic",
      "zh-Hans-CN/fiction",
      "zh-Hans-CN/newmedia",
    ],
  },
  {
    language: "zh-Hant",
    profiles: ["zh-Hant-TW", "zh-Hant-TW/gongwen", "zh-Hant-HK", "zh-Hant-CN"],
  },
  {
    language: "en",
    profiles: [
      "en-US/general",
      "en-US/news",
      "en-US/tech-google",
      "en-US/tech-microsoft",
      "en-US/apa",
      "en-US/mla",
      "en-US/army",
      "en-GB/govuk",
      "en-GB/oxford",
      "en-AU",
    ],
  },
  {
    language: "ja",
    profiles: ["ja/jtf", "ja/koyobun", "ja/fiction", "ja/tech"],
  },
  { language: "ko", profiles: ["ko", "ko/official"] },
  { language: "es", profiles: ["es-ES", "es-419", "es/eu"] },
  { language: "fr", profiles: ["fr-FR", "fr-CA", "fr-CH", "fr/eu"] },
  {
    language: "de",
    profiles: ["de-DE", "de-DE/din5008", "de-AT", "de-CH", "de/eu"],
  },
  { language: "ru", profiles: ["ru", "ru/gost"] },
  { language: "pt", profiles: ["pt-BR", "pt-BR/official", "pt-PT", "pt/eu"] },
];

const ALL_PROFILES = new Set(CONVENTION_PROFILES.flatMap((g) => g.profiles));

export function isConventionsValue(value: unknown): value is string {
  return (
    value === AUTOMATIC_CONVENTIONS ||
    (typeof value === "string" && ALL_PROFILES.has(value))
  );
}

type VariantKey =
  | "conventionsGeneral"
  | "conventionsFiction"
  | "conventionsTech"
  | "conventionsOfficial"
  | "conventionsAcademic"
  | "conventionsNews"
  | "conventionsNewMedia"
  | "conventionsEu";

/** A variant's name: one of ours, a proper name, or both. */
const VARIANTS: Record<string, { key?: VariantKey; name?: string }> = {
  general: { key: "conventionsGeneral" },
  fiction: { key: "conventionsFiction" },
  tech: { key: "conventionsTech" },
  "tech-google": { key: "conventionsTech", name: "Google" },
  "tech-microsoft": { key: "conventionsTech", name: "Microsoft" },
  gongwen: { key: "conventionsOfficial" },
  koyobun: { key: "conventionsOfficial" },
  official: { key: "conventionsOfficial" },
  academic: { key: "conventionsAcademic" },
  news: { key: "conventionsNews" },
  newmedia: { key: "conventionsNewMedia" },
  eu: { key: "conventionsEu" },
  apa: { name: "APA" },
  mla: { name: "MLA" },
  army: { name: "AR 25-50" },
  govuk: { name: "GOV.UK" },
  oxford: { name: "Oxford" },
  jtf: { name: "JTF" },
  din5008: { name: "DIN 5008" },
  gost: { name: "GOST" },
};

function displayName(
  locale: string,
  type: "language" | "region",
  code: string,
): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type, style: "short" }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

/** The region a profile is for ("US" in "en-US/news"), if it names one. */
function regionOf(profile: string): string | undefined {
  return profile
    .split("/")[0]
    .split("-")
    .slice(1)
    .find((part) => /^([A-Z]{2}|\d{3})$/.test(part));
}

/** A document language's name in the UI language ("Simplified Chinese"). */
export function conventionsLanguageName(lang: Lang, language: string): string {
  return displayName(localeOf(lang), "language", language);
}

/** A profile's name within its language: its region and variant
 *  ("United States · News"), or "Standard" when it has neither. */
export function conventionsProfileName(
  t: Strings,
  lang: Lang,
  profile: string,
): string {
  const [, variant] = profile.split("/");
  const region = regionOf(profile);
  // A language whose profiles are all for one region (every Simplified
  // Chinese one is mainland China's) doesn't repeat it on each.
  const siblings = CONVENTION_PROFILES.find((g) =>
    g.profiles.includes(profile),
  )?.profiles;
  const oneRegion = !!siblings && siblings.every((p) => regionOf(p) === region);
  const parts: string[] = [];
  if (region && !oneRegion)
    parts.push(displayName(localeOf(lang), "region", region));
  const v = variant ? VARIANTS[variant] : undefined;
  if (v?.key) parts.push(t[v.key]);
  if (v?.name) parts.push(v.name);
  if (variant && !v) parts.push(variant);
  return parts.length ? parts.join(" · ") : t.conventionsStandard;
}
