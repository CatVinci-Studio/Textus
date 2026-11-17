import grainImage from "./frame-grain.png?inline";

/** Matches FrameTexture in docs/dev/textus.d.ts. Plugins supply numbers,
 *  never URLs; the only image is this bundled, deterministic noise tile.
 *  Tile from Prism (ArcMD contributors), MIT: its notice ships in
 *  public/THIRD_PARTY_NOTICES.txt. */
export interface FrameTexture {
  opacity: number;
  color?: "black" | "white";
}

export function checkFrameTexture(value: unknown): FrameTexture | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "frameTexture is an object with opacity and optional color.",
    );
  const { opacity, color } = value as FrameTexture;
  if (
    typeof opacity !== "number" ||
    !Number.isFinite(opacity) ||
    opacity < 0 ||
    opacity > 1
  )
    throw new Error("frameTexture.opacity is a number from 0 to 1.");
  if (color !== undefined && color !== "black" && color !== "white")
    throw new Error('frameTexture.color is "black" or "white".');
  return { opacity, color };
}

/** An image layer needs a gradient beneath it, even for a solid paint. */
export function texturedPaint(
  paint: string,
  texture: FrameTexture,
  dark: boolean,
): string {
  if (!texture.opacity) return paint;
  const white = texture.color ? texture.color === "white" : dark;
  const c = white ? 1 : 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><filter id="n"><feColorMatrix type="matrix" values="0 0 0 0 ${c} 0 0 0 0 ${c} 0 0 0 0 ${c} 0 0 0 1 0"/></filter><image href="${grainImage}" width="128" height="128" filter="url(#n)" opacity="${texture.opacity}"/></svg>`;
  const base = paint.includes("gradient(")
    ? paint
    : `linear-gradient(${paint}, ${paint})`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}"), ${base}`;
}
