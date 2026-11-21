import { DEFAULT_SETTINGS, type Settings } from "./settings-types";

/** What "Use the classic look" sets: how Textus looked before 1.4. */
type Look = NonNullable<Settings["lookBeforeClassic"]>;

const LOOK_KEYS = ["layout", "activityRail", "titleRowShown"] as const;

export const CLASSIC_LOOK: Look = {
  layout: "classic",
  activityRail: false,
  titleRowShown: true,
};

function lookOf(settings: Look): Look {
  return Object.fromEntries(
    LOOK_KEYS.map((key) => [key, settings[key]]),
  ) as unknown as Look;
}

/** On while the three settings are the classic look's, however they got
 *  there. */
export function isClassicLook(settings: Settings): boolean {
  return LOOK_KEYS.every((key) => settings[key] === CLASSIC_LOOK[key]);
}

/** Turning it on keeps the look it leaves; off puts that back, or the
 *  defaults when there is none. */
export function classicLookChange(
  on: boolean,
  settings: Settings,
): Partial<Settings> {
  return on
    ? { ...CLASSIC_LOOK, lookBeforeClassic: lookOf(settings) }
    : {
        ...(settings.lookBeforeClassic ?? lookOf(DEFAULT_SETTINGS)),
        lookBeforeClassic: null,
      };
}

/** A stored look, or null when it isn't one. */
export function storedLook(value: unknown): Look | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  return (v.layout === "islands" || v.layout === "classic") &&
    typeof v.activityRail === "boolean" &&
    typeof v.titleRowShown === "boolean"
    ? lookOf(v as unknown as Look)
    : null;
}
