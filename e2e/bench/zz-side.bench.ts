import { test } from "@playwright/test";
import { SAMPLE_DOC, openApp, pasteMarkdown } from "../helpers";

const LONG = Array.from({ length: 8 }, () => SAMPLE_DOC).join("\n\n");
const emit = (page: import("@playwright/test").Page, name: string) =>
  page.evaluate((n) => (window as unknown as { __devEmitTauriEvent: (n: string) => void }).__devEmitTauriEvent(n), name);

test("profile sidebar edge drag", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, { animations: true, settings: { language: "en" } });
  await pasteMarkdown(page, LONG);
  await emit(page, "menu-toggle-sidebar");
  await emit(page, "menu-toggle-agent-panel");
  await page.waitForTimeout(800);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  const box = (await page.locator(".sidebar-resizer").boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await cdp.send("Profiler.start");
  for (let i = 1; i <= 40; i++) { await page.mouse.move(x + i * 3, y); await page.waitForTimeout(16); }
  const { profile } = (await cdp.send("Profiler.stop")) as { profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[]; samples: number[]; timeDeltas: number[] } };
  await page.mouse.up();
  const self = new Map<number, number>();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const key = (n: { callFrame: { functionName: string; url: string; lineNumber: number } }) => (n.callFrame.functionName || "(anon)") + " " + n.callFrame.url.replace(/.*\/(src|node_modules)\//, "$1/").replace(/\?.*/, "") + ":" + n.callFrame.lineNumber;
  const top = (m: Map<string, number>, k = 30) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([kk, v]) => (v / 1000).toFixed(1).padStart(7) + "ms " + kk).join("\n");
  const callers = (want: RegExp) => { const m = new Map<string, number>(); for (const [id, t] of self) { const n = byId.get(id)!; if (!want.test(key(n))) continue; let cur = parent.get(id); while (cur !== undefined && !/ src\//.test(key(byId.get(cur)!))) cur = parent.get(cur); const kk = cur === undefined ? "?" : key(byId.get(cur)!); m.set(kk, (m.get(kk) ?? 0) + t); } return top(m, 15); };
  const total = new Map<string, number>();
  for (const [id, t] of self) { const seen = new Set<string>(); let cur: number | undefined = id; while (cur !== undefined) { const kk = key(byId.get(cur)!); if (/ src\//.test(kk) && !seen.has(kk)) { seen.add(kk); total.set(kk, (total.get(kk) ?? 0) + t); } cur = parent.get(cur); } }
  console.log("READS BY\n" + callers(/clientWidth|clientHeight|getBoundingClientRect|getClientRects|offset[A-Z]|scroll(Height|Top|Width|Left)|getComputedStyle|elementsFromPoint/));
  console.log("JSX BY\n" + callers(/jsxDEV|createElement|ReactElement/));
  console.log("SRC TOTAL\n" + top(total, 40));
});
