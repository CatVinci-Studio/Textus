var __defProp = Object.defineProperty;
var __name = (target, value) =>
  __defProp(target, "name", { value, configurable: true });

// worker.ts
import { EmailMessage } from "cloudflare:email";

// issue.ts
var KINDS = { bug: "bug", idea: "enhancement", question: "question" };
var AREAS = ["editor", "ai", "plugins", "panes", "export", "files", "other"];
var SEVERITIES = ["blocker", "major", "minor"];
var LIMITS = { description: 5e3, details: 2e4, contact: 200, short: 100 };
var text = /* @__PURE__ */ __name(
  (value, max) =>
    typeof value === "string" && value.length <= max ? value.trim() : null,
  "text",
);
function readReport(raw) {
  if (!raw || typeof raw !== "object") return "not a report";
  const r = raw;
  if (typeof r.kind !== "string" || !(r.kind in KINDS)) return "kind";
  if (!AREAS.includes(r.area)) return "area";
  if (r.severity !== void 0 && !SEVERITIES.includes(r.severity))
    return "severity";
  const description = text(r.description, LIMITS.description);
  if (!description || description.length < 5) return "description";
  const details = text(r.details ?? "", LIMITS.details);
  if (details === null) return "details";
  const contact = text(r.contact ?? "", LIMITS.contact);
  if (contact === null) return "contact";
  const version = text(r.version, LIMITS.short);
  const language = text(r.language, LIMITS.short);
  if (!version || !language) return "version";
  return {
    kind: r.kind,
    area: r.area,
    severity: r.kind === "bug" ? r.severity : void 0,
    description,
    details,
    contact: contact || void 0,
    version,
    language,
  };
}
__name(readReport, "readReport");
var quiet = /* @__PURE__ */ __name(
  (s) => s.replace(/@(?=\w)/g, "@\u200B"),
  "quiet",
);
var fenced = /* @__PURE__ */ __name(
  (s) => s.replace(/`{3,}/g, "\u02BC\u02BC\u02BC"),
  "fenced",
);
function issueFor(report) {
  const firstLine = report.description.split("\n")[0].trim();
  const title =
    firstLine.length > 80 ? `${firstLine.slice(0, 79)}\u2026` : firstLine;
  const labels = [
    KINDS[report.kind],
    `area: ${report.area}`,
    ...(report.severity ? [`severity: ${report.severity}`] : []),
    "from the app",
  ];
  const body = [
    quiet(report.description),
    "",
    "<details><summary>Textus</summary>",
    "",
    "```",
    fenced(quiet(report.details)),
    "```",
    "</details>",
    "",
    `_Sent from Textus ${report.version} (${report.language}) with Help \u203A Report a Problem${report.contact ? "; the sender left a way to reach them, kept private" : ""}._`,
  ].join("\n");
  return { title, body, labels };
}
__name(issueFor, "issueFor");

// worker.ts
var PER_SENDER_A_DAY = 5;
var ALL_A_DAY = 300;
var MAX_BODY = 4e4;
var worker_default = {
  async fetch(request, env) {
    if (request.method !== "POST") return reply(405, { error: "method" });
    const raw = await request.text();
    if (raw.length > MAX_BODY) return reply(413, { error: "size" });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return reply(400, { error: "json" });
    }
    const report = readReport(parsed);
    if (typeof report === "string") return reply(400, { error: report });
    const sender = await hash(request.headers.get("CF-Connecting-IP") ?? "");
    if (!(await allowed(env.LIMITS, sender)))
      return reply(429, { error: "limit" });
    const token = await installationToken(env);
    const issue = issueFor(report);
    const made = await github(env, token, `/repos/${env.REPO}/issues`, issue);
    if (!made.ok) return reply(502, { error: "github" });
    const { html_url: url, number } = await made.json();
    if (report.contact) await mailContact(env, report, url);
    return reply(201, { url, number });
  },
};
function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
__name(reply, "reply");
async function hash(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest).slice(0, 12)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
__name(hash, "hash");
async function allowed(kv, sender) {
  const day = /* @__PURE__ */ new Date().toISOString().slice(0, 10);
  const keys = [`${day}:${sender}`, `${day}:all`];
  const counts = await Promise.all(keys.map((k) => kv.get(k)));
  const [mine, all] = counts.map((c) => Number(c ?? 0));
  if (mine >= PER_SENDER_A_DAY || all >= ALL_A_DAY) return false;
  const day2 = { expirationTtl: 2 * 24 * 3600 };
  await Promise.all([
    kv.put(keys[0], String(mine + 1), day2),
    kv.put(keys[1], String(all + 1), day2),
  ]);
  return true;
}
__name(allowed, "allowed");
function github(env, token, path, body) {
  return fetch(`https://api.github.com${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "textus-feedback",
      "x-github-api-version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : void 0,
  });
}
__name(github, "github");
async function installationToken(env) {
  const jwt = await appJwt(env);
  const found = await github(env, jwt, `/repos/${env.REPO}/installation`);
  const { id } = await found.json();
  const made = await fetch(
    `https://api.github.com/app/installations/${id}/access_tokens`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: "application/vnd.github+json",
        "user-agent": "textus-feedback",
      },
    },
  );
  return (await made.json()).token;
}
__name(installationToken, "installationToken");
async function appJwt(env) {
  const now = Math.floor(Date.now() / 1e3);
  const part = /* @__PURE__ */ __name(
    (o) => base64url(JSON.stringify(o)),
    "part",
  );
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iat: now - 60, exp: now + 540, iss: env.APP_ID })}`;
  const der = Uint8Array.from(
    atob(env.APP_KEY.replace(/-----[^-]+-----|\s/g, "")),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}
__name(appJwt, "appJwt");
function base64url(data) {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
__name(base64url, "base64url");
async function mailContact(env, report, url) {
  const subject = `Textus report: a contact for ${url.split("/").pop()}`;
  const raw = [
    `From: Textus Feedback <${env.MAIL_FROM}>`,
    `To: ${env.MAIL_TO}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "",
    `${url}`,
    "",
    `Contact: ${report.contact}`,
  ].join("\r\n");
  try {
    await env.MAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw));
  } catch {}
}
__name(mailContact, "mailContact");
export { worker_default as default };
//# sourceMappingURL=worker.js.map
