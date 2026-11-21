import type { TextKey } from "../i18n/strings";

/** A page's colours in one appearance. */
export interface PageColours {
  bg: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
  quote: string;
  codeBg: string;
}

/** Code's colours in one appearance (the --doc-token-* variables). */
export interface SyntaxColours {
  keyword: string;
  string: string;
  function: string;
  number: string;
  tag: string;
}

interface Palette<T> {
  id: string;
  nameKey: TextKey;
  light: T;
  dark: T;
}

/** The workshop's page palettes; contrast is held by workshop-palettes.test.ts
 *  (text, secondary text and links against the page, AA). */
export const PAGE_PALETTES: readonly Palette<PageColours>[] = [
  {
    id: "rice-paper",
    nameKey: "paletteRicePaper",
    light: {
      bg: "#fbf8f1",
      text: "#2a2723",
      muted: "#6b6458",
      accent: "#8a4b2a",
      border: "#e5dfd1",
      quote: "#c2a27a",
      codeBg: "#f2ede1",
    },
    dark: {
      bg: "#1d1b18",
      text: "#e9e3d6",
      muted: "#a39a89",
      accent: "#e0a476",
      border: "#3a352d",
      quote: "#8f7552",
      codeBg: "#27241f",
    },
  },
  {
    id: "mist",
    nameKey: "paletteMist",
    light: {
      bg: "#f6f8fa",
      text: "#1f2933",
      muted: "#5b6774",
      accent: "#2563a8",
      border: "#dde3ea",
      quote: "#9fb3c8",
      codeBg: "#edf1f5",
    },
    dark: {
      bg: "#161b22",
      text: "#dde4ec",
      muted: "#96a2b0",
      accent: "#7fb2ec",
      border: "#2d3540",
      quote: "#4f6377",
      codeBg: "#1e252e",
    },
  },
  {
    id: "moss",
    nameKey: "paletteMoss",
    light: {
      bg: "#f5f7f1",
      text: "#24301f",
      muted: "#5a6753",
      accent: "#3a683c",
      border: "#dbe2d2",
      quote: "#93ad86",
      codeBg: "#ebf0e3",
    },
    dark: {
      bg: "#151a13",
      text: "#dfe8d8",
      muted: "#97a68e",
      accent: "#8cc58a",
      border: "#2c3627",
      quote: "#577052",
      codeBg: "#1d241a",
    },
  },
  {
    id: "dusk",
    nameKey: "paletteDusk",
    light: {
      bg: "#f8f6fb",
      text: "#2a2433",
      muted: "#645b71",
      accent: "#6440b8",
      border: "#e3ddeb",
      quote: "#b3a3d1",
      codeBg: "#efebf5",
    },
    dark: {
      bg: "#1a1720",
      text: "#e6e0ef",
      muted: "#a197b0",
      accent: "#b69cf2",
      border: "#352f40",
      quote: "#6e5e8f",
      codeBg: "#231f2b",
    },
  },
  {
    id: "ink",
    nameKey: "paletteInk",
    light: {
      bg: "#ffffff",
      text: "#111111",
      muted: "#555555",
      accent: "#0b57d0",
      border: "#d6d6d6",
      quote: "#8a8a8a",
      codeBg: "#f3f3f3",
    },
    dark: {
      bg: "#0f0f0f",
      text: "#f2f2f2",
      muted: "#b0b0b0",
      accent: "#8ab4f8",
      border: "#333333",
      quote: "#6a6a6a",
      codeBg: "#1b1b1b",
    },
  },
  {
    id: "sandstone",
    nameKey: "paletteSandstone",
    light: {
      bg: "#fcf6f0",
      text: "#2e241e",
      muted: "#6a5b51",
      accent: "#a8432a",
      border: "#ecdccf",
      quote: "#d39a7c",
      codeBg: "#f5eadf",
    },
    dark: {
      bg: "#1e1814",
      text: "#eee2d8",
      muted: "#a8978a",
      accent: "#f0906f",
      border: "#3b2f27",
      quote: "#94604a",
      codeBg: "#28201b",
    },
  },
];

/** The workshop's code palettes; each token reads (AA) on every page
 *  palette's code background and the default's. */
export const SYNTAX_PALETTES: readonly Palette<SyntaxColours>[] = [
  {
    id: "amber",
    nameKey: "syntaxAmber",
    light: {
      keyword: "#9a3c1c",
      string: "#4f6b12",
      function: "#7a4d00",
      number: "#a1361f",
      tag: "#8c2f5c",
    },
    dark: {
      keyword: "#f4a27a",
      string: "#c3d98a",
      function: "#f2c56b",
      number: "#f59f8b",
      tag: "#ec9dc4",
    },
  },
  {
    id: "harbor",
    nameKey: "syntaxHarbor",
    light: {
      keyword: "#1d5fa8",
      string: "#1f6f5c",
      function: "#5b46b0",
      number: "#a24a12",
      tag: "#a3305a",
    },
    dark: {
      keyword: "#86b8f2",
      string: "#7fd1b9",
      function: "#b8a6f5",
      number: "#f3b37a",
      tag: "#f095b5",
    },
  },
  {
    id: "orchard",
    nameKey: "syntaxOrchard",
    light: {
      keyword: "#a0306a",
      string: "#37701e",
      function: "#1f6aa0",
      number: "#9b5a00",
      tag: "#b03a2e",
    },
    dark: {
      keyword: "#f09ac7",
      string: "#a6d98a",
      function: "#8cc3ef",
      number: "#e9c06a",
      tag: "#f39a8f",
    },
  },
  {
    id: "neon",
    nameKey: "syntaxNeon",
    light: {
      keyword: "#7a2fc2",
      string: "#0d7a52",
      function: "#0b63c4",
      number: "#b03a0a",
      tag: "#c0266d",
    },
    dark: {
      keyword: "#c792ff",
      string: "#7ee8b5",
      function: "#82c8ff",
      number: "#ffb36b",
      tag: "#ff86c0",
    },
  },
  {
    id: "graphite",
    nameKey: "syntaxGraphite",
    light: {
      keyword: "#2f2f2f",
      string: "#5a5a5a",
      function: "#1e3a5f",
      number: "#5e4630",
      tag: "#4a3a55",
    },
    dark: {
      keyword: "#f0f0f0",
      string: "#bdbdbd",
      function: "#b9cde6",
      number: "#d9c2a8",
      tag: "#cdbbd9",
    },
  },
];

const PAGE_VARS: Record<keyof PageColours, string> = {
  bg: "--doc-bg",
  text: "--doc-text",
  muted: "--doc-muted",
  accent: "--doc-accent",
  border: "--doc-border",
  quote: "--doc-quote-border",
  codeBg: "--doc-code-bg",
};

/** The variables a page palette and a code palette set in one appearance;
 *  an id of "" (or unknown) sets nothing. */
export function paletteVariables(
  page: string,
  syntax: string,
  dark: boolean,
): [string, string][] {
  const form = dark ? "dark" : "light";
  const pageColours = PAGE_PALETTES.find((p) => p.id === page)?.[form];
  const code = SYNTAX_PALETTES.find((p) => p.id === syntax)?.[form];
  return [
    ...(pageColours
      ? (Object.keys(PAGE_VARS) as (keyof PageColours)[]).map(
          (k): [string, string] => [PAGE_VARS[k], pageColours[k]],
        )
      : []),
    ...(code
      ? (Object.keys(code) as (keyof SyntaxColours)[]).map(
          (k): [string, string] => [`--doc-token-${k}`, code[k]],
        )
      : []),
  ];
}
