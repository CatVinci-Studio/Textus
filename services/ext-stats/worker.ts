/**
 * textus-ext-stats: how often plugins, themes and skills are installed.
 * The app downloads through /api/ext/download, which adds one to a daily
 * total and redirects to the package; an uninstall is posted to
 * /api/ext/event. /api/ext/stats gives the totals the catalogs show. Only
 * daily totals are kept: no address, no identifier. See README.md.
 */
import {
  ADD_SQL,
  COUNT_FIELDS,
  DOWNLOAD_EVENTS,
  OTHER_EVENTS,
  dayOf,
  fromApp,
  packageUrl,
  readCount,
  summarize,
  TOTALS_SQL,
  type Count,
  type Row,
} from "./counts";

interface Env {
  DB: D1Database;
}

/** How long the totals are served from the cache. */
const STATS_MAX_AGE = 3600;
const MAX_BODY = 2_000;

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    if (path.endsWith("/api/ext/download")) return download(request, env, ctx);
    if (path.endsWith("/api/ext/event")) return event(request, env);
    if (path.endsWith("/api/ext/stats")) return stats(request, env, ctx);
    return reply(404, { error: "path" });
  },
};

async function download(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return reply(405, { error: "method" });
  const fields = Object.fromEntries(new URL(request.url).searchParams);
  const target = packageUrl(fields);
  if (!target) return reply(404, { error: "package" });
  const count = fromApp(request.headers.get("user-agent"))
    ? readCount(fields, DOWNLOAD_EVENTS)
    : null;
  // Counting must not hold up the download, nor fail it.
  if (count) ctx.waitUntil(add(env.DB, count).catch(logged));
  return new Response(null, {
    status: 302,
    headers: { location: target, "cache-control": "no-store" },
  });
}

async function event(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return reply(405, { error: "method" });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return reply(413, { error: "size" });
  let fields: unknown;
  try {
    fields = JSON.parse(raw);
  } catch {
    return reply(400, { error: "json" });
  }
  const count =
    fields && typeof fields === "object"
      ? readCount(fields as Record<string, unknown>, OTHER_EVENTS)
      : null;
  if (!count) return reply(400, { error: "event" });
  if (fromApp(request.headers.get("user-agent"))) await add(env.DB, count);
  return new Response(null, { status: 204 });
}

async function stats(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "GET") return reply(405, { error: "method" });
  const cache = caches.default;
  const key = new Request(new URL(request.url).origin + "/api/ext/stats");
  const kept = await cache.match(key);
  if (kept) return kept;
  const now = new Date();
  const { results } = await env.DB.prepare(TOTALS_SQL)
    .bind(dayOf(now, 29))
    .all<Row>();
  const response = new Response(
    JSON.stringify({ date: dayOf(now), ...summarize(results) }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": `public, max-age=${STATS_MAX_AGE}`,
        "access-control-allow-origin": "*",
      },
    },
  );
  ctx.waitUntil(cache.put(key, response.clone()));
  return response;
}

/** Adds one to today's total for `count`. */
function add(db: D1Database, count: Count) {
  return db
    .prepare(ADD_SQL)
    .bind(dayOf(new Date()), ...COUNT_FIELDS.map((k) => count[k]))
    .run();
}

function logged(err: unknown) {
  console.error("count failed", String(err));
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
