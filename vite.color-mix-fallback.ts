import type { AtRule, Container, Declaration, Plugin } from "postcss";

/**
 * color-mix() needs Chromium 111, older than some WebView2. With a var() in
 * it, an old engine computes the property to `unset`, so each such rule gets
 * an `@supports not` twin with every mix replaced by a plain colour.
 */
export const COLOR_MIX_UNSUPPORTED =
  "not (color: color-mix(in srgb, red, red))";

/** The hue of a theme token in the light appearance, for a tint of it; dark
 *  tints are close enough at these low opacities. */
const TINTS: [RegExp, string][] = [
  [/^var\(\s*--(editor|chrome)-(accent|primary)\b/, "49 94 209"],
  [/^var\(\s*--success-color\b/, "36 115 77"],
  [/^var\(\s*--danger(-fill)?\b/, "190 54 75"],
  [/^var\(\s*--warning-color\b/, "154 98 18"],
];
const NEUTRAL = "128 128 128";
/** A background colour: a tint of something over it is that thing's tint. */
const BACKGROUND = /^var\(\s*--([a-z]+-)*bg\b/;

/** The PostCSS plugin. Warns (as Vite prints) on a mix it can't lower. */
export function colorMixFallback(): Plugin {
  return {
    postcssPlugin: "color-mix-fallback",
    OnceExit(root, { AtRule, result }) {
      root.walkRules((rule) => {
        const mixed = rule.nodes.filter(
          (node): node is Declaration =>
            node.type === "decl" && /color-mix\(/i.test(node.value),
        );
        if (mixed.length === 0) return;
        if (!canHoldSupports(rule.parent)) {
          rule.warn(
            result,
            "color-mix() here gets no fallback for engines without it",
          );
          return;
        }
        const twin = rule.clone({ nodes: [] });
        for (const decl of mixed) {
          twin.append(decl.clone({ value: lowerColorMix(decl.value) }));
        }
        const supports: AtRule = new AtRule({
          name: "supports",
          params: COLOR_MIX_UNSUPPORTED,
        });
        supports.append(twin);
        rule.after(supports);
      });
    },
  };
}

/** Keyframes can't hold an @supports; everything else a rule sits in can. */
function canHoldSupports(parent: Container | undefined): boolean {
  return !(
    parent?.type === "atrule" && /keyframes$/i.test((parent as AtRule).name)
  );
}

/** `value` with every color-mix() in it replaced by its plain colour. */
export function lowerColorMix(value: string): string {
  let out = "";
  let i = 0;
  for (;;) {
    const start = value.slice(i).search(/color-mix\(/i);
    if (start < 0) return out + value.slice(i);
    const open = i + start + "color-mix(".length - 1;
    const close = matchingParen(value, open);
    if (close < 0) return out + value.slice(i);
    out += value.slice(i, i + start);
    out += mixFallback(lowerColorMix(value.slice(open + 1, close)));
    i = close + 1;
  }
}

function matchingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Splits on commas outside parentheses. */
function topLevelArgs(s: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) {
      args.push(s.slice(from, i).trim());
      from = i + 1;
    }
  }
  args.push(s.slice(from).trim());
  return args;
}

/** "var(--x) 14%" -> ["var(--x)", 14]; the percentage may come first. */
function colorStop(arg: string): [string, number | null] {
  const match =
    /^([\s\S]*?)\s+(-?[\d.]+)%$/.exec(arg) ??
    /^(-?[\d.]+)%\s+([\s\S]*)$/.exec(arg);
  if (!match) return [arg, null];
  return /%$/.test(arg)
    ? [match[1].trim(), Number(match[2])]
    : [match[2].trim(), Number(match[1])];
}

/** The plain colour for the arguments of one color-mix(). */
function mixFallback(inner: string): string {
  const [, first = "", second = ""] = topLevelArgs(inner);
  let [a, p] = colorStop(first);
  let [b, q] = colorStop(second);
  if (p === null && q === null) p = q = 50;
  else if (p === null) p = 100 - q!;
  else if (q === null) q = 100 - p;
  // The colour being tinted first, what it is laid over second.
  if (isBase(a) && !isBase(b)) [a, b, p, q] = [b, a, q!, p];
  const weight = (p! / (p! + q!)) * 100;
  if (!isBase(b)) return weight >= 50 ? a : b;
  if (weight >= 50) return a;
  const tint = tintOf(a);
  return tint ? `rgb(${tint} / ${round(weight)}%)` : "transparent";
}

function isBase(color: string): boolean {
  return /^transparent$/i.test(color) || BACKGROUND.test(color);
}

/** "r g b" for a tint of `color`, or null for a background itself (a tint
 *  of the page's own colour over the page is no tint at all). */
function tintOf(color: string): string | null {
  if (BACKGROUND.test(color)) return null;
  const hex = /#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(color);
  for (const [token, rgb] of TINTS) if (token.test(color)) return rgb;
  if (hex) return hexToRgb(hex[1]);
  return NEUTRAL;
}

function hexToRgb(hex: string): string {
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : hex;
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)).join(" ");
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
