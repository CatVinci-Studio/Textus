// What a ```chart block says: a small JSON spec, checked before drawing so a
// mistake keeps the source on screen, as a broken diagram does.

export const CHART_TYPES = ["bar", "line", "area", "pie", "scatter"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartSeries {
  name: string;
  /** One value per label; for a scatter, [x, y] pairs. */
  data: number[] | [number, number][];
}

export interface ChartSpec {
  type: ChartType;
  title?: string;
  /** The axes' labels. */
  x?: string;
  y?: string;
  /** The categories along x (bar, line, area) or the slices (pie). */
  labels: string[];
  series: ChartSeries[];
  caption?: string;
  source?: string;
}

/** Past this, hues stop telling series apart: fold the rest into "Other". */
export const MAX_SERIES = 8;
const MAX_POINTS = 1000;

const fail = (message: string): never => {
  throw new Error(`chart: ${message}`);
};

const optionalText = (value: unknown, field: string): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") fail(`"${field}" must be text`);
  return (value as string).trim() || undefined;
};

const isNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** The spec in `source`; throws with what is wrong. */
export function parseChartSpec(source: string): ChartSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return fail("not valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return fail("expected a JSON object");
  const obj = raw as Record<string, unknown>;
  const type = obj.type ?? "bar";
  if (!CHART_TYPES.includes(type as ChartType))
    fail(`"type" must be one of ${CHART_TYPES.join(", ")}`);

  const rawSeries = obj.series ?? (obj.data ? [{ data: obj.data }] : null);
  if (!Array.isArray(rawSeries) || rawSeries.length === 0)
    fail('"series" must be a non-empty list');
  const list = rawSeries as unknown[];
  if (list.length > MAX_SERIES) fail(`at most ${MAX_SERIES} series`);

  const series = list.map((entry, i): ChartSeries => {
    if (!entry || typeof entry !== "object")
      fail(`series ${i + 1} is not an object`);
    const { name, data } = entry as Record<string, unknown>;
    if (!Array.isArray(data) || data.length === 0)
      fail(`series ${i + 1} needs a non-empty "data" list`);
    const values = data as unknown[];
    if (values.length > MAX_POINTS)
      fail(`at most ${MAX_POINTS} points a series`);
    const ok =
      type === "scatter"
        ? values.every(
            (p) => Array.isArray(p) && p.length === 2 && p.every(isNumber),
          )
        : values.every(isNumber);
    if (!ok)
      fail(
        type === "scatter"
          ? `series ${i + 1}: "data" must be [x, y] number pairs`
          : `series ${i + 1}: "data" must be numbers`,
      );
    return {
      name: optionalText(name, "name") ?? `Series ${i + 1}`,
      data: values as ChartSeries["data"],
    };
  });

  if (type === "pie" && (series[0].data as number[]).some((v) => v < 0))
    fail("a pie's values can't be negative");

  const longest = Math.max(...series.map((s) => s.data.length));
  // Models often list the categories as "x" rather than the axis' title:
  // they are the categories then, before any "labels".
  const xList = Array.isArray(obj.x) ? (obj.x as unknown[]) : null;
  let labels: string[];
  if (xList && type !== "scatter" && xList.length >= longest) {
    labels = xList.map((l) => (isNumber(l) ? String(l) : String(l ?? "")));
  } else if (obj.labels === undefined) {
    labels = Array.from({ length: longest }, (_, i) => String(i + 1));
  } else {
    if (!Array.isArray(obj.labels)) return fail('"labels" must be a list');
    labels = obj.labels.map((l) => (isNumber(l) ? String(l) : String(l ?? "")));
    if (type !== "scatter" && labels.length < longest)
      fail('fewer "labels" than data points');
  }

  return {
    type: type as ChartType,
    title: optionalText(obj.title, "title"),
    x: optionalText(xList ? obj.xLabel : (obj.x ?? obj.xLabel), "x"),
    y: optionalText(obj.y ?? obj.yLabel, "y"),
    labels,
    series,
    caption: optionalText(obj.caption, "caption"),
    source: optionalText(obj.source, "source"),
  };
}
