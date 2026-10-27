import { test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// [name, markdown, anchor text, where ("start"|"end"|offset|"to:<text>" selects anchor start..text end), keys]
type Case = [string, string, string, string | number, string[]];
const C: Case[] = [
["K BS after link once", "see [Textus](https://a.com) end", " end", "start", ["wait","Backspace"]],
["K Del before link", "see [Textus](https://a.com) end", "see ", "end", ["wait","Delete"]],
];

test("probe", async ({ page }) => {
  test.setTimeout(1_200_000);
  const out: string[] = [];
  for (const [name, md, text, where, keys] of C) {
    await openApp(page, { settings: { enableCompletion: false } });
    if (md) await pasteMarkdown(page, md);
    else await page.locator('[data-active-tab="true"] .ProseMirror').click();
    const doc = () =>
      page.evaluate(() => {
        const ed = document.querySelector<any>('[data-active-tab="true"] .ProseMirror')!;
        return String(ed.pmViewDesc.node);
      });
    const before = await doc();
    const ok =
      !md ||
      (await page.evaluate(
        ({ text, where }) => {
          const ed = document.querySelector<any>('[data-active-tab="true"] .ProseMirror')!;
          const desc = ed.pmViewDesc;
          const find = (t: string, w: string | number) => {
            let pos = -1;
            desc.node.descendants((n: any, p: number) => {
              if (pos >= 0 || !n.isTextblock) return pos < 0;
              if (!n.textContent.includes(t)) return false;
              // Walk the text nodes: atoms (pictures) take a position but no text.
              n.descendants((c: any, q: number) => {
                if (pos >= 0 || !c.isText) return pos < 0;
                const i = c.text.indexOf(t);
                if (i < 0) return false;
                const off = w === "start" ? i : w === "end" ? i + t.length : i + (w as number);
                pos = p + 1 + q + off;
                return false;
              });
              return false;
            });
            return pos;
          };
          let a: number, b: number;
          if (typeof where === "string" && where.startsWith("to:")) {
            a = find(text, "start");
            b = find(where.slice(3), "end");
          } else a = b = find(text, where);
          if (a < 0 || b < 0) return false;
          const da = desc.domFromPos(a, 0);
          const db = desc.domFromPos(b, 0);
          ed.focus();
          const s = getSelection()!;
          s.setBaseAndExtent(da.node, da.offset, db.node, db.offset);
          return true;
        },
        { text, where },
      ));
    await page.waitForTimeout(150);
    for (const k of keys) {
      if (k === "wait") { console.log("  mid:   ", await doc()); continue; }
      if (k.startsWith("type:")) await page.keyboard.type(k.slice(5), { delay: 15 });
      else if (k.startsWith("paste:")) { page.on("console", (m) => console.log("CONSOLE", m.text())); page.on("pageerror", (e) => console.log("PAGEERR", e.message, (e.stack||"").split("\n").slice(0,8).join(" | "))); await page.evaluate((md) => { const ed = document.querySelector<HTMLElement>('[data-active-tab="true"] .ProseMirror')!; const d = new DataTransfer(); d.setData("text/plain", md); ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true })); }, k.slice(6)); await page.waitForTimeout(300); }
      else await page.keyboard.press(k);
      await page.waitForTimeout(100);
    }
    const after = await doc() + " | src=" + (await page.evaluate(() => { const ed = document.querySelector<any>('[data-active-tab="true"] .ProseMirror')!; return ed.innerText.slice(0, 60); })) + " | sel=" + (await page.evaluate(() => { const ed = document.querySelector<any>('[data-active-tab="true"] .ProseMirror')!; const sel = getSelection()!; return (ed.querySelector(".ProseMirror-selectednode") ? "NODE " : "") + sel.anchorOffset; }));
    out.push(`## ${name}${ok ? "" : " (TEXT NOT FOUND)"}\n  keys: ${keys.join(" ")}\n  before: ${before}\n  after:  ${after}`);
  }
  console.log("\n" + out.join("\n"));
});
