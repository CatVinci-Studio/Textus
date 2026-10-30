import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appMinor, packageUrl, readCount, summarize } from "./counts";
import worker from "./worker";

const PLUGINS =
  "https://github.com/CatVinci-Studio/textus-plugins/releases/download/";
const APP = { "user-agent": "Textus/1.3.0-beta.7" };

/** D1 as the Worker uses it, over an in-memory SQLite with the migration. */
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(new URL("migrations/0001_daily.sql", import.meta.url), "utf8"),
  );
  const prepare = (sql: string) => ({
    bind: (...args: (string | number)[]) => ({
      run: async () => db.prepare(sql).run(...args),
      all: async () => ({ results: db.prepare(sql).all(...args) }),
    }),
  });
  return { db, binding: { prepare } as unknown as D1Database };
}

let store: ReturnType<typeof d1>;
let pending: Promise<unknown>[];
const ctx = {
  waitUntil: (p: Promise<unknown>) => void pending.push(p),
} as unknown as ExecutionContext;

async function call(path: string, init: RequestInit = {}) {
  const response = await worker.fetch(
    new Request(`https://textus.catvinci.com/api/ext/${path}`, init),
    { DB: store.binding },
    ctx,
  );
  await Promise.all(pending);
  return response;
}

const download = (query: string, headers: Record<string, string> = APP) =>
  call(`download?${query}`, { headers, redirect: "manual" });

const totals = () =>
  store.db
    .prepare("SELECT event, os, app, count FROM daily ORDER BY event")
    .all();

beforeEach(() => {
  store = d1();
  pending = [];
  vi.stubGlobal("caches", {
    default: { match: async () => undefined, put: async () => {} },
  });
});
afterEach(() => vi.unstubAllGlobals());

const plugin =
  "kind=plugin&id=catvinci.tasks&version=0.1.1&os=mac&app=1.3.0-beta.7";

describe("a download through the endpoint", () => {
  it("adds one to the day's total and goes on to the package", async () => {
    const first = await download(`${plugin}&event=install`);
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe(
      `${PLUGINS}catvinci.tasks-v0.1.1/catvinci.tasks-0.1.1.zip`,
    );
    await download(`${plugin}&event=install`);
    await download(`${plugin}&event=update`);
    expect(totals()).toEqual([
      { event: "install", os: "mac", app: "1.3", count: 2 },
      { event: "update", os: "mac", app: "1.3", count: 1 },
    ]);
  });

  it("counts nothing a crawler follows, nor a malformed one, but still redirects", async () => {
    const crawler = await download(`${plugin}&event=install`, {
      "user-agent": "Mozilla/5.0",
    });
    expect(crawler.status).toBe(302);
    expect((await download(`${plugin}&event=uninstall`)).status).toBe(302);
    expect((await download(`${plugin}&event=install&os=amiga`)).status).toBe(
      302,
    );
    expect(totals()).toEqual([]);
  });

  it("goes nowhere but a package its catalog would list", async () => {
    for (const query of [
      "kind=plugin&id=catvinci.tasks&version=../../x",
      "kind=plugin&id=evil.com/x&version=1.0.0",
      "kind=theme&id=plain&file=../index.json",
      "kind=theme&id=Plain",
      "kind=skill&id=a/b",
      "kind=other&id=a",
      "url=https://evil.test",
    ])
      expect((await download(query)).status, query).toBe(404);
  });
});

describe("the package a download asks for", () => {
  it("is where each catalog keeps it", () => {
    expect(packageUrl({ kind: "skill", id: "press-release" })).toBe(
      `${PLUGINS}catalog/skill-press-release.md`,
    );
    expect(packageUrl({ kind: "theme", id: "plain" })).toBe(
      "https://raw.githubusercontent.com/CatVinci-Studio/textus-themes/main/themes/plain/theme.css",
    );
    expect(
      packageUrl({ kind: "theme", id: "plain", file: "light.css" }),
    ).toMatch(/plain\/light\.css$/);
  });
});

describe("an uninstall", () => {
  const body = {
    kind: "theme",
    id: "plain",
    version: "2026-10-18T04:55:06Z",
    event: "uninstall",
    os: "windows",
    app: "1.3.0",
  };
  const post = (fields: unknown, headers = APP) =>
    call("event", { method: "POST", headers, body: JSON.stringify(fields) });

  it("is counted once posted by the app, and only an uninstall is", async () => {
    expect((await post(body)).status).toBe(204);
    expect((await post({ ...body, event: "install" })).status).toBe(400);
    expect((await post(body, { "user-agent": "curl/8" })).status).toBe(204);
    expect(totals()).toEqual([
      { event: "uninstall", os: "windows", app: "1.3", count: 1 },
    ]);
  });
});

describe("the totals", () => {
  it("give installs ever and lately, recent updates by version, and uninstalls", async () => {
    const add = (
      day: string,
      id: string,
      version: string,
      event: string,
      n: number,
    ) =>
      store.db
        .prepare(
          "INSERT INTO daily VALUES (?, 'plugin', ?, ?, ?, 'mac', '1.3', ?)",
        )
        .run(day, id, version, event, n);
    const today = new Date().toISOString().slice(0, 10);
    add("2020-01-01", "catvinci.tasks", "0.1.0", "install", 5);
    add(today, "catvinci.tasks", "0.1.1", "install", 2);
    add(today, "catvinci.tasks", "0.1.1", "reinstall", 7);
    add(today, "catvinci.tasks", "0.1.1", "update", 3);
    add("2020-01-01", "catvinci.tasks", "0.1.0", "update", 9);
    add(today, "catvinci.tasks", "0.1.1", "uninstall", 1);
    const response = await call("stats");
    expect(response.headers.get("cache-control")).toContain("max-age");
    const stats = await response.json();
    expect(stats.plugin["catvinci.tasks"]).toEqual({
      installs: 7,
      installs30: 2,
      updates30: 3,
      uninstalls: 1,
      updates30ByVersion: { "0.1.1": 3 },
    });
    expect(stats.theme).toEqual({});
  });

  it("are summed per extension whatever the platform", () => {
    const row = {
      kind: "skill",
      id: "tighten",
      version: "1.0.0",
      event: "install",
    };
    expect(
      summarize([
        { ...row, total: 2, recent: 1 },
        { ...row, version: "1.0.1", total: 3, recent: 3 },
      ]).skill.tighten,
    ).toMatchObject({ installs: 5, installs30: 4 });
  });
});

describe("a count's fields", () => {
  it("keep the app's minor version only", () => {
    expect(appMinor("1.3.0-beta.7")).toBe("1.3");
    expect(appMinor("12.40.1")).toBe("12.40");
    expect(appMinor("x")).toBeNull();
    expect(
      readCount(
        {
          kind: "skill",
          id: "tighten",
          version: "1.0.0",
          event: "install",
          os: "ios",
          app: "1.3.0",
        },
        ["install"],
      ),
    ).toEqual({
      kind: "skill",
      id: "tighten",
      version: "1.0.0",
      event: "install",
      os: "ios",
      app: "1.3",
    });
  });
});
