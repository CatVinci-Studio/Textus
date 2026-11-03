/**
 * The README cards' frame - a cut of the app in a rounded window on the
 * website's paper - for a still picture or, frame by frame, a short film.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

/** Every small card: one size, whichever grid it is in. */
export const CARD = 4 / 3;

export interface Framing {
  /** The frame's width / height. */
  aspect: number;
  /** The frame's width in CSS pixels. */
  width: number;
  /** The room between the window's edge and the cut. */
  inset: number;
  /** The part of the screenshot to show, in its pixels; all of it if left out. */
  crop?: Box;
  type?: "image/webp" | "image/png";
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The area around `targets` - their bounds joined, `margin` CSS pixels on
 *  every side - inside the viewport, in whole pixels: a fractional clip
 *  leaves seams in Chromium's tiles. */
export async function around(
  page: Page,
  targets: Locator[],
  margin: number,
  name: string,
): Promise<Box> {
  const boxes = await Promise.all(targets.map((t) => t.boundingBox()));
  const found = boxes.filter((b) => b !== null);
  expect(found.length, `${name}: nothing to cut around`).toBe(targets.length);
  return joined(page, found, margin);
}

function joined(page: Page, boxes: Box[], margin: number): Box {
  const view = page.viewportSize()!;
  const x = Math.max(
    0,
    Math.round(Math.min(...boxes.map((b) => b.x)) - margin),
  );
  const y = Math.max(
    0,
    Math.round(Math.min(...boxes.map((b) => b.y)) - margin),
  );
  const right = Math.min(
    view.width,
    Math.round(Math.max(...boxes.map((b) => b.x + b.width)) + margin),
  );
  const bottom = Math.min(
    view.height,
    Math.round(Math.max(...boxes.map((b) => b.y + b.height)) + margin),
  );
  return { x, y, width: right - x, height: bottom - y };
}

/** How long the first and last frames stay, in milliseconds. */
const HOLD = { first: 700, last: 2600 };

/**
 * A short film of `act`, framed as a card and written as an animated WebP
 * to `file`: screenshots as fast as they come while it plays, cut to the
 * area `targets` take up before it and after it. Frames that show nothing new
 * are joined; it loops.
 */
export async function film(
  page: Page,
  file: string,
  targets: (after: boolean) => Locator[],
  act: () => Promise<void>,
  framing: Omit<Framing, "crop" | "type">,
  margin = 20,
) {
  const before = await around(page, targets(false), margin, file);
  const shots: { png: Buffer; at: number }[] = [];
  let rolling = true;
  const camera = (async () => {
    while (rolling)
      shots.push({ png: await page.screenshot(), at: Date.now() });
  })();
  await page.waitForTimeout(300);
  await act();
  await page.waitForTimeout(400);
  rolling = false;
  await camera;
  const after = await around(page, targets(true), margin, file);
  const scale = await page.evaluate(() => window.devicePixelRatio);
  const box = joined(page, [before, after], 0);
  const crop = {
    x: box.x * scale,
    y: box.y * scale,
    width: box.width * scale,
    height: box.height * scale,
  };
  const dir = mkdtempSync(path.join(tmpdir(), "textus-film-"));
  try {
    const args = ["-loop", "0", "-lossy", "-q", "82", "-m", "4"];
    let last: Buffer | null = null;
    let lastFile = "";
    let lastAt = shots[0].at;
    const frames: { file: string; ms: number }[] = [];
    for (const [i, shot] of shots.entries()) {
      const png = await framed(page, shot.png, {
        ...framing,
        crop,
        type: "image/png",
      });
      if (last && png.equals(last)) continue;
      if (lastFile) frames.push({ file: lastFile, ms: shot.at - lastAt });
      lastFile = path.join(dir, `${String(i).padStart(4, "0")}.png`);
      writeFileSync(lastFile, png);
      last = png;
      lastAt = shot.at;
    }
    frames.push({ file: lastFile, ms: HOLD.last });
    frames[0].ms = Math.max(frames[0].ms, HOLD.first);
    for (const f of frames) args.push("-d", String(Math.max(40, f.ms)), f.file);
    const out = path.join(dir, "film.webp");
    execFileSync("img2webp", [...args, "-o", out]);
    writeFileSync(file, readFileSync(out));
    // For a look at what went in: TEXTUS_FILM_FRAMES=<dir> keeps the frames.
    const keep = process.env.TEXTUS_FILM_FRAMES;
    if (keep)
      cpSync(dir, path.join(keep, path.basename(file, ".webp")), {
        recursive: true,
      });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `png` (at the page's scale) in a window on the website's paper, the
 *  frame `width` CSS pixels wide: small, so the words are large where the
 *  README shows it. Drawn on a canvas: a large image in a page left seams
 *  in Chromium's screenshot. */
export async function framed(
  page: Page,
  png: Buffer,
  { aspect, width, inset, crop, type = "image/webp" }: Framing,
): Promise<Buffer> {
  const data = await page.evaluate(
    async ({ src, aspect, width, inset, crop, type }) => {
      const scale = 2;
      const W = width * scale;
      const H = Math.round(W / aspect);
      const img = new Image();
      img.src = src;
      await img.decode();
      // The part of the picture to show, in its own pixels: all of it, or
      // a film's cut.
      const cut = crop ?? { x: 0, y: 0, width: img.width, height: img.height };
      // The window fills the room, the same for every card; the cut sits
      // in it as large as it fits, on its own colour.
      const pad = inset * scale;
      const x = 20 * scale;
      const y = 18 * scale;
      const w = W - 2 * x;
      const h = H - 2 * y;
      const fit = Math.min(
        (w - 2 * pad) / cut.width,
        (h - 2 * pad) / cut.height,
      );
      const iw = Math.round(cut.width * fit);
      const ih = Math.round(cut.height * fit);
      const ix = Math.round(x + (w - iw) / 2);
      const iy = Math.round(y + (h - ih) / 2);
      const r = 12 * scale;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      const paper = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 1.2);
      paper.addColorStop(0, "#ffffff");
      paper.addColorStop(0.55, "#faf7f1");
      paper.addColorStop(1, "#f3eee4");
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, W, H);
      const window = new Path2D();
      window.roundRect(x, y, w, h, r);
      // The website's shadow: a close one and a wide soft one below.
      ctx.save();
      ctx.shadowColor = "rgba(29, 43, 58, 0.16)";
      ctx.shadowBlur = 28 * scale;
      ctx.shadowOffsetY = 14 * scale;
      ctx.fillStyle = "#fff";
      ctx.fill(window);
      ctx.restore();
      ctx.save();
      ctx.clip(window);
      const probe = document.createElement("canvas");
      probe.width = probe.height = 1;
      // Its colour at the middle of its left edge: a corner may be a
      // dialog's backdrop showing past its rounding.
      probe
        .getContext("2d")!
        .drawImage(
          img,
          cut.x + 1,
          cut.y + Math.floor(cut.height / 2),
          1,
          1,
          0,
          0,
          1,
          1,
        );
      const [r0, g0, b0] = probe
        .getContext("2d")!
        .getImageData(0, 0, 1, 1).data;
      ctx.fillStyle = `rgb(${r0}, ${g0}, ${b0})`;
      ctx.fill(window);
      ctx.drawImage(img, cut.x, cut.y, cut.width, cut.height, ix, iy, iw, ih);
      ctx.restore();
      ctx.strokeStyle = "rgba(29, 43, 58, 0.1)";
      ctx.lineWidth = scale;
      ctx.stroke(window);
      // WebP: a tenth of the PNG, the same to the eye.
      return canvas.toDataURL(type, 0.92);
    },
    {
      src: `data:image/png;base64,${png.toString("base64")}`,
      aspect,
      width,
      inset,
      crop,
      type,
    },
  );
  return Buffer.from(data.split(",")[1], "base64");
}
