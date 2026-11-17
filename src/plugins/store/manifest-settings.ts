import { whenReadable } from "../contributions/when";
import type { SettingContribution, SettingType } from "./manifest-types";
import { ManifestError, list, object, text, type Json } from "./manifest-json";

/** A plugin's settings in its manifest, checked: each type's default, its
 *  options and range. */

const SETTING_TYPES: readonly SettingType[] = [
  "boolean",
  "string",
  "number",
  "enum",
  "color",
  "list",
  "button",
];

/** What a setting's default must be, by its type. */
function checkDefault(s: Json, type: SettingType, at: string): void {
  const fallback = s.default;
  const ok =
    type === "button"
      ? fallback === undefined
      : type === "list"
        ? Array.isArray(fallback) &&
          fallback.every((v) => typeof v === "string")
        : type === "color"
          ? typeof fallback === "string" && /^#[0-9a-f]{6}$/i.test(fallback)
          : typeof fallback === (type === "enum" ? "string" : type);
  if (ok) return;
  const expected = {
    button: "left out",
    list: "a list of strings",
    color: 'a colour like "#3366ff"',
    enum: "a string",
  }[type as string];
  throw new ManifestError(`${at}.default must be ${expected ?? `a ${type}`}.`);
}

export function number(value: unknown, what: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number")
    throw new ManifestError(`${what} must be a number.`);
  return value;
}

export function parseSetting(raw: unknown, at: string): SettingContribution {
  const s = object(raw, at);
  const type = s.type as SettingType;
  if (!SETTING_TYPES.includes(type))
    throw new ManifestError(
      `${at}.type must be one of ${SETTING_TYPES.join(", ")}.`,
    );
  checkDefault(s, type, at);
  const when = text(s.when, `${at}.when`, true) || undefined;
  if (when && !whenReadable(when))
    throw new ManifestError(
      `${at}.when must be a when clause: "key", "!key", "key == value", joined with && or ||.`,
    );
  const min = number(s.min, `${at}.min`);
  const max = number(s.max, `${at}.max`);
  const options =
    type === "enum"
      ? list(s.options, `${at}.options`).map((o, i) => {
          const opt = object(o, `${at}.options[${i}]`);
          return {
            value: text(opt.value, `${at}.options[${i}].value`),
            label: text(opt.label, `${at}.options[${i}].label`),
          };
        })
      : undefined;
  if (options && !options.some((o) => o.value === s.default))
    throw new ManifestError(`${at}.default must be one of its options.`);
  if (
    typeof s.default === "number" &&
    ((min !== undefined && s.default < min) ||
      (max !== undefined && s.default > max))
  )
    throw new ManifestError(`${at}.default must be within min and max.`);
  return {
    key: text(s.key, `${at}.key`),
    type,
    default: s.default as SettingContribution["default"],
    title: text(s.title, `${at}.title`),
    description: text(s.description, `${at}.description`, true) || undefined,
    group: text(s.group, `${at}.group`, true) || undefined,
    when,
    options,
    ...(type === "string" && s.multiline === true ? { multiline: true } : {}),
    ...(type === "number" ? { min, max } : {}),
    ...(type === "button" ? { command: text(s.command, `${at}.command`) } : {}),
  };
}
