import { describe, expect, it } from "vitest";
import tauriConfig from "../../../src-tauri/tauri.conf.json";
import { webviewCsp } from "./frames";
import { hostDocument } from "./host-document";

const security = tauriConfig.app.security;
const windowCsp: Record<string, string[]> = security.csp;

function parse(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter((words) => words[0])
      .map(([name, ...sources]) => [name, sources]),
  );
}

/** What the window's policy allows for `directive`, as a browser falls
 *  back to default-src. */
function windowSources(directive: string): string[] {
  return windowCsp[directive] ?? windowCsp["default-src"];
}

/** `source` allowed by `allowed`: the same token, or a scheme source
 *  (`https:`) covering a host source of that scheme. */
function covers(allowed: string[], source: string): boolean {
  if (source === "'none'") return true;
  return allowed.some(
    (entry) =>
      entry === source || (entry.endsWith(":") && source.startsWith(entry)),
  );
}

/** A frame made from srcdoc inherits the window's policy on top of its
 *  own, so the window must allow all a frame's own policy does. */
function expectAllowedByWindow(framePolicy: string) {
  for (const [directive, sources] of Object.entries(parse(framePolicy))) {
    if (directive === "default-src") continue;
    const allowed = windowSources(directive);
    for (const source of sources)
      expect(covers(allowed, source), `${directive} ${source}`).toBe(true);
  }
}

describe("the window's Content Security Policy", () => {
  it("allows everything a plugin's webview may load, framing any host", () => {
    expectAllowedByWindow(webviewCsp(["*"]));
    expectAllowedByWindow(webviewCsp(["example.com"]));
  });

  it("lets a page show pictures only from the hosts its plugin was granted", () => {
    expect(parse(webviewCsp(["example.com"]))["img-src"]).toContain(
      "https://example.com",
    );
    expect(parse(webviewCsp([]))["img-src"]).not.toContain("https:");
    expect(parse(webviewCsp(["*"]))["connect-src"]).not.toContain("https:");
  });

  it("allows a plugin host's inline scripts", () => {
    const meta = /content="([^"]+)"/.exec(hostDocument(""))?.[1] ?? "";
    expect(meta).toContain("script-src");
    expectAllowedByWindow(meta);
  });

  it("keeps scripts, styles, fonts, media and connections off the network", () => {
    for (const directive of [
      "default-src",
      "script-src",
      "style-src",
      "font-src",
      "media-src",
      "connect-src",
      "worker-src",
    ])
      for (const source of windowSources(directive))
        expect(
          source === "*" ||
            source === "https:" ||
            source === "http:" ||
            (/^https?:\/\//.test(source) && !/\.localhost$/.test(source)),
          `${directive} ${source}`,
        ).toBe(false);
  });

  it("frames only HTTPS pages: a web page tab never loads over plain HTTP", () => {
    expect(windowSources("frame-src")).not.toContain("http:");
  });

  it("is not given hashes, which would switch 'unsafe-inline' off in plugin frames", () => {
    expect(security.dangerousDisableAssetCspModification).toEqual(
      expect.arrayContaining(["script-src", "style-src"]),
    );
  });
});
