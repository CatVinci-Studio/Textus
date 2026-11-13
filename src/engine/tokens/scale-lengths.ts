/**
 * A plugin page's lengths, as the interface draws them: times
 * `--chrome-scale`, as the build does the app's (vite.chrome-scale.ts). A
 * plugin's are written in the first design's pixels, which Medium draws a
 * step larger: each is taken to Medium's even pixel first, as the app's own
 * stylesheets were once.
 */

import { atMedium } from "../../utils/at-medium";

/** A length worth scaling: 3px and up; hairlines stay crisp. */
const LENGTH = /(^|[\s(,/+*])(-?\d*\.?\d+)px\b/g;
const SCALED = /--(chrome-scale|ui-text-scale|window-scale)\b/;

/** `value` with each length of 3px or more times the chrome's scale. */
export function scaleLengths(value: string): string {
  if (SCALED.test(value)) return value;
  return value.replace(LENGTH, (whole, before: string, n: string) =>
    Math.abs(Number(n)) < 3 || Math.abs(Number(n)) >= 999
      ? whole
      : `${before}calc(${atMedium(Number(n))}px * var(--chrome-scale, 1))`,
  );
}

/** A declaration in a rule: `name: value`, up to its `;` or `}`. Not an
 *  at-rule's prelude, which a media query's widths are. */
const DECLARATION = /([{;]\s*)(--[\w-]+|[a-z-]+)(\s*:)([^;{}]*)/gi;

/** A stylesheet's text with its declarations' lengths scaled. */
export function scaleStylesheet(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(
      DECLARATION,
      (_, start: string, name: string, colon: string, value: string) =>
        `${start}${name}${colon}${scaleLengths(value)}`,
    );
}
