import katexCss from "katex/dist/katex.min.css?raw";

/**
 * KaTeX's stylesheet with its fonts inside it, as data: URLs: for a page
 * that can't load the app's own files (a plugin's frame) and for a saved
 * file that must show formulas offline. Only the woff2 faces; every engine
 * Textus runs on reads them. Made once, when first asked.
 */
const FONTS = import.meta.glob<string>(
  "/node_modules/katex/dist/fonts/*.woff2",
  { query: "?url", import: "default" },
);

let made: Promise<string> | null = null;

export function katexInlineCss(): Promise<string> {
  made ??= build().catch((err: unknown) => {
    made = null;
    throw err;
  });
  return made;
}

async function build(): Promise<string> {
  const inline = new Map<string, string>();
  await Promise.all(
    Object.entries(FONTS).map(async ([path, url]) => {
      const bytes = new Uint8Array(
        await (await fetch(await url())).arrayBuffer(),
      );
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      inline.set(path.slice(path.lastIndexOf("/") + 1), btoa(binary));
    }),
  );
  // Each face's sources become its woff2 alone, inline.
  return katexCss.replace(
    /src:url\(fonts\/([\w-]+)\.woff2\)[^;}]*/g,
    (whole, name: string) => {
      const data = inline.get(`${name}.woff2`);
      return data
        ? `src:url(data:font/woff2;base64,${data}) format("woff2")`
        : whole;
    },
  );
}
