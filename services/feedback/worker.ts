/**
 * textus-feedback: Help › Report a Problem's reports, filed as GitHub
 * issues by the Textus Feedback GitHub App, so no one needs a GitHub
 * account to send one. A contact left with a report is mailed to the team,
 * never put in the issue. See README.md.
 */
import { EmailMessage } from "cloudflare:email";
import { issueFor, readReport, type Report } from "./issue";

interface Env {
  APP_ID: string;
  /** The app's private key, PKCS#8 PEM. */
  APP_KEY: string;
  REPO: string;
  LIMITS: KVNamespace;
  MAIL: SendEmail;
  MAIL_FROM: string;
  MAIL_TO: string;
}

const PER_SENDER_A_DAY = 5;
const ALL_A_DAY = 300;
const MAX_BODY = 40_000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") return reply(405, { error: "method" });
    const raw = await request.text();
    if (raw.length > MAX_BODY) return reply(413, { error: "size" });
    let parsed: unknown;
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
    const { html_url: url, number } = (await made.json()) as {
      html_url: string;
      number: number;
    };
    if (report.contact) await mailContact(env, report, url);
    return reply(201, { url, number });
  },
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest).slice(0, 12)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A few reports a day from one sender, and a ceiling for everyone. */
async function allowed(kv: KVNamespace, sender: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
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

function github(env: Env, token: string, path: string, body?: unknown) {
  return fetch(`https://api.github.com${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "textus-feedback",
      "x-github-api-version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** The app's token for the repository it is installed on. */
async function installationToken(env: Env): Promise<string> {
  const jwt = await appJwt(env);
  const found = await github(env, jwt, `/repos/${env.REPO}/installation`);
  const { id } = (await found.json()) as { id: number };
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
  return ((await made.json()) as { token: string }).token;
}

async function appJwt(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const part = (o: unknown) => base64url(JSON.stringify(o));
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

function base64url(data: string | Uint8Array): string {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function mailContact(env: Env, report: Report, url: string) {
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
  } catch {
    // The issue is filed; a contact that can't be mailed is lost, not leaked.
  }
}
