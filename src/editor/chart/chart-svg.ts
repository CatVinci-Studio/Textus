// A ```chart block drawn as SVG, by hand: a charting library would outweigh
// the rest of the editor. Loaded on first use (diagram-engine.ts).

import { parseChartSpec, type ChartSpec } from "./chart-spec";

export { parseChartSpec };

export interface ChartLayout {
  /** The width to lay the chart out at, in CSS px. */
  width: number;
  fontFamily?: string;
  dark?: boolean;
}

// The categorical hues in fixed order, each stepped for its surface (the
// dataviz reference palette, validated for colour-blind separation).
const SERIES = {
  light: [
    "#2a78d6",
    "#eb6834",
    "#1baf7a",
    "#eda100",
    "#e87ba4",
    "#008300",
    "#6250d6",
    "#e34948",
  ],
  dark: [
    "#3987e5",
    "#d95926",
    "#199e70",
    "#c98500",
    "#d55181",
    "#008300",
    "#9085e9",
    "#e66767",
  ],
};

// Ink is the document's, so a theme recolours it; the fallbacks are base.css's
// defaults, used where no stylesheet reaches (an exported PNG).
function ink(dark: boolean) {
  const v = (name: string, light: string, darkValue: string) =>
    `var(--doc-${name}, ${dark ? darkValue : light})`;
  return {
    text: v("text", "#24272e", "#e4e7ed"),
    muted: v("muted", "#6b6b6b", "#989da6"),
    grid: v("border", "#e1e4ea", "#333230"),
    surface: v("bg", "#ffffff", "#1b1e24"),
  };
}

// Type sizes: the footnote, small-body and body-large roles of
// design-system.css, read beside the document's body text.
const TICK = 12;
const LABEL = 13;
const TITLE = 15;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// CJK characters and full-width punctuation take a whole em; the rest about
// half of one.
const WIDE =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;
const textWidth = (s: string, size: number) =>
  [...s].reduce((w, ch) => w + (WIDE.test(ch) ? 1 : 0.58), 0) * size;

/** `s` broken into lines no wider than `width`: at spaces where it has
 *  them, else anywhere, as CJK text breaks. */
export function wrapText(s: string, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const token of s.match(/\S+\s*|\s+/g) ?? []) {
    if (textWidth(line + token.trimEnd(), size) <= width) {
      line += token;
      continue;
    }
    if (line.trim()) lines.push(line.trimEnd());
    line = "";
    for (const ch of token) {
      if (line && textWidth(line + ch, size) > width) {
        lines.push(line.trimEnd());
        line = "";
      }
      line += ch;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

/** About `count` round steps covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max)
    [min, max] = min === 0 ? [0, 1] : [Math.min(0, min), Math.max(0, max)];
  const raw = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let t = Math.floor(min / step) * step; t <= max + step * 1e-9; t += step)
    ticks.push(Number(t.toPrecision(12)));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

const fmt = (n: number) =>
  Math.abs(n) >= 1e6 || (Math.abs(n) < 1e-3 && n !== 0)
    ? n.toExponential(1)
    : n.toLocaleString("en-US", { maximumFractionDigits: 3 });

/** The SVG for a ```chart block's source; throws when the spec is wrong. */
export function renderChart(source: string, layout: ChartLayout): string {
  return chartSvg(parseChartSpec(source), layout);
}

export function chartSvg(spec: ChartSpec, layout: ChartLayout): string {
  const dark = !!layout.dark;
  const colors = SERIES[dark ? "dark" : "light"];
  const c = ink(dark);
  const W = Math.round(Math.min(Math.max(layout.width, 320), 760));
  const out: string[] = [];
  const text = (
    x: number,
    y: number,
    s: string,
    size: number,
    fill: string,
    extra = "",
  ) =>
    out.push(
      `<text x="${x}" y="${y}" font-size="${size}" style="fill:${fill}"${extra}>${esc(s)}</text>`,
    );

  let top = 8;
  if (spec.title) {
    text(0, top + TITLE, spec.title, TITLE, c.text, ' font-weight="600"');
    top += TITLE + 12;
  }
  // A legend for two or more series, or a pie's slices: colour never alone.
  const keys =
    spec.type === "pie"
      ? spec.labels.slice(0, spec.series[0].data.length)
      : spec.series.length > 1
        ? spec.series.map((s) => s.name)
        : [];
  if (keys.length) {
    let x = 0;
    keys.forEach((name, i) => {
      const w = textWidth(name, LABEL) + 26;
      if (x > 0 && x + w > W) {
        x = 0;
        top += LABEL + 8;
      }
      out.push(
        `<rect data-id="key-${i}" x="${x}" y="${top + 2}" width="10" height="10" rx="2" style="fill:${colors[i % colors.length]}"/>`,
      );
      text(x + 14, top + LABEL - 1, name, LABEL, c.muted);
      x += w;
    });
    top += LABEL + 12;
  }

  const plotH = Math.round(Math.min(W * 0.55, 360));
  let below = 0;
  if (spec.type === "pie") drawPie(spec, out, W, top, plotH, colors, c);
  else below = drawAxes(spec, out, text, W, top, plotH, colors, c);
  let bottom =
    top + plotH + below + (spec.type === "pie" ? 8 : spec.x ? 44 : 26);

  const notes = [spec.caption, spec.source && `Source: ${spec.source}`].filter(
    Boolean,
  ) as string[];
  for (const line of notes.flatMap((n) => wrapText(n, LABEL, W))) {
    text(0, bottom + LABEL, line, LABEL, c.muted);
    bottom += LABEL + 6;
  }

  const font = layout.fontFamily
    ? ` style="font-family:${esc(layout.fontFamily)}"`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="textus-chart" viewBox="0 0 ${W} ${bottom + 4}" ` +
    `width="${W}" height="${bottom + 4}" role="img" aria-label="${esc(spec.title ?? `${spec.type} chart`)}"${font}>` +
    out.join("") +
    "</svg>"
  );
}

type Ink = ReturnType<typeof ink>;

function drawPie(
  spec: ChartSpec,
  out: string[],
  W: number,
  top: number,
  h: number,
  colors: string[],
  c: Ink,
) {
  const values = spec.series[0].data as number[];
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const r = h / 2 - 4;
  const cx = W / 2;
  const cy = top + h / 2;
  let angle = -Math.PI / 2;
  values.forEach((v, i) => {
    const sweep = (v / total) * Math.PI * 2;
    const label = `${spec.labels[i] ?? i + 1}: ${fmt(v)} (${Math.round((v / total) * 100)}%)`;
    const fill = `style="fill:${colors[i % colors.length]};stroke:${c.surface};stroke-width:2"`;
    if (sweep >= Math.PI * 2 - 1e-9) {
      out.push(
        `<circle data-id="slice-${i}" cx="${cx}" cy="${cy}" r="${r}" ${fill}><title>${esc(label)}</title></circle>`,
      );
      return;
    }
    const p = (a: number) =>
      `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
    const d = `M${cx} ${cy}L${p(angle)}A${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${p(angle + sweep)}Z`;
    out.push(
      `<path data-id="slice-${i}" d="${d}" ${fill}><title>${esc(label)}</title></path>`,
    );
    angle += sweep;
  });
}

function drawAxes(
  spec: ChartSpec,
  out: string[],
  text: (
    x: number,
    y: number,
    s: string,
    size: number,
    fill: string,
    extra?: string,
  ) => void,
  W: number,
  top: number,
  h: number,
  colors: string[],
  c: Ink,
): number {
  const scatter = spec.type === "scatter";
  const ys = spec.series.flatMap((s) =>
    scatter
      ? (s.data as [number, number][]).map((p) => p[1])
      : (s.data as number[]),
  );
  // Bars and areas stand on zero; a scatter shows where its points are.
  const yTicks = scatter
    ? niceTicks(Math.min(...ys), Math.max(...ys))
    : niceTicks(Math.min(0, ...ys), Math.max(0, ...ys));
  const xs = scatter
    ? spec.series.flatMap((s) =>
        (s.data as [number, number][]).map((p) => p[0]),
      )
    : [];
  const xTicks = scatter ? niceTicks(Math.min(...xs), Math.max(...xs)) : [];

  const left =
    (spec.y ? 20 : 0) +
    Math.max(...yTicks.map((t) => textWidth(fmt(t), TICK))) +
    8;
  const plotW = W - left - 16;
  const bottom = top + h;
  const [y0, y1] = [yTicks[0], yTicks[yTicks.length - 1]];
  const Y = (v: number) => bottom - ((v - y0) / (y1 - y0)) * h;

  for (const t of yTicks) {
    const y = Y(t).toFixed(1);
    out.push(
      `<line x1="${left}" x2="${left + plotW}" y1="${y}" y2="${y}" style="stroke:${c.grid}"/>`,
    );
    text(left - 6, Number(y) + 4, fmt(t), TICK, c.muted, ' text-anchor="end"');
  }
  const n = spec.labels.length;
  const band = plotW / n;
  const X = (j: number) => left + band * (j + 0.5);
  // Every label on two lines at most where that fits; else skip some along
  // a crowded axis.
  const wrapped = scatter
    ? []
    : spec.labels.map((l) => wrapText(l, TICK, band - 6));
  const twoLines = wrapped.every((lines) => lines.length <= 2);
  const widest = Math.max(...spec.labels.map((l) => textWidth(l, TICK))) + 6;
  const every = twoLines ? 1 : Math.max(1, Math.ceil(widest / band));
  const extra = twoLines && wrapped.some((lines) => lines.length > 1);

  if (spec.y)
    text(
      0,
      0,
      spec.y,
      LABEL,
      c.muted,
      ` text-anchor="middle" transform="translate(${LABEL} ${top + h / 2}) rotate(-90)"`,
    );
  if (spec.x)
    text(
      left + plotW / 2,
      bottom + 40 + (extra ? TICK + 3 : 0),
      spec.x,
      LABEL,
      c.muted,
      ' text-anchor="middle"',
    );

  if (scatter) {
    const [x0, x1] = [xTicks[0], xTicks[xTicks.length - 1]];
    const X = (v: number) => left + ((v - x0) / (x1 - x0)) * plotW;
    for (const t of xTicks)
      text(X(t), bottom + 18, fmt(t), TICK, c.muted, ' text-anchor="middle"');
    spec.series.forEach((s, i) => {
      const dots = (s.data as [number, number][]).map(
        ([x, y]) =>
          `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="4"><title>${esc(`${s.name}: ${fmt(x)}, ${fmt(y)}`)}</title></circle>`,
      );
      out.push(
        `<g data-id="series-${i}" style="fill:${colors[i]};stroke:${c.surface};stroke-width:2">${dots.join("")}</g>`,
      );
    });
    return 0;
  }

  spec.labels.forEach((l, j) => {
    if (j % every !== 0) return;
    const x = Number(X(j).toFixed(1));
    if (!twoLines || wrapped[j].length < 2) {
      text(x, bottom + 18, l, TICK, c.muted, ' text-anchor="middle"');
      return;
    }
    out.push(
      `<text x="${x}" y="${bottom + 18}" font-size="${TICK}" text-anchor="middle" style="fill:${c.muted}">` +
        wrapped[j]
          .map(
            (line, k) =>
              `<tspan x="${x}" dy="${k ? TICK + 3 : 0}">${esc(line)}</tspan>`,
          )
          .join("") +
        "</text>",
    );
  });

  if (spec.type === "bar") {
    const inner = band * 0.72;
    const bw = Math.max(1, inner / spec.series.length - 2);
    const zero = Y(0);
    spec.series.forEach((s, i) => {
      const bars = (s.data as number[]).map((v, j) => {
        const x = X(j) - inner / 2 + i * (bw + 2) + 1;
        const y = Y(v);
        // Rounded at the data end, square on the baseline.
        const r = Math.min(4, bw / 2, Math.abs(zero - y));
        const s1 = v >= 0 ? 1 : -1;
        const d =
          `M${x.toFixed(1)} ${zero.toFixed(1)}V${(y + s1 * r).toFixed(1)}` +
          `Q${x.toFixed(1)} ${y.toFixed(1)} ${(x + r).toFixed(1)} ${y.toFixed(1)}` +
          `H${(x + bw - r).toFixed(1)}Q${(x + bw).toFixed(1)} ${y.toFixed(1)} ${(x + bw).toFixed(1)} ${(y + s1 * r).toFixed(1)}` +
          `V${zero.toFixed(1)}Z`;
        return `<path d="${d}"><title>${esc(`${s.name}, ${spec.labels[j]}: ${fmt(v)}`)}</title></path>`;
      });
      out.push(
        `<g data-id="series-${i}" style="fill:${colors[i]}">${bars.join("")}</g>`,
      );
    });
    return extra ? TICK + 3 : 0;
  }

  spec.series.forEach((s, i) => {
    const pts = (s.data as number[]).map((v, j) => [X(j), Y(v)] as const);
    const line = pts
      .map(([x, y], j) => `${j ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join("");
    const parts: string[] = [];
    if (spec.type === "area") {
      const base = Y(Math.max(y0, 0)).toFixed(1);
      parts.push(
        `<path d="${line}L${pts[pts.length - 1][0].toFixed(1)} ${base}L${pts[0][0].toFixed(1)} ${base}Z" style="fill:${colors[i]};fill-opacity:0.16;stroke:none"/>`,
      );
    }
    parts.push(
      `<path d="${line}" style="fill:none;stroke:${colors[i]};stroke-width:2;stroke-linejoin:round;stroke-linecap:round"/>`,
    );
    if (pts.length <= 40)
      parts.push(
        ...pts.map(
          ([x, y], j) =>
            `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" style="fill:${colors[i]};stroke:${c.surface};stroke-width:2"><title>${esc(`${s.name}, ${spec.labels[j]}: ${fmt((s.data as number[])[j])}`)}</title></circle>`,
        ),
      );
    out.push(`<g data-id="series-${i}">${parts.join("")}</g>`);
  });
  return extra ? TICK + 3 : 0;
}
