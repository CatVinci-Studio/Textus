import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * The panel's motion through a streamed run of edits, frame by frame: the
 * end row's label stays steady, the group takes its first card's place
 * without fading in again, and a decision slides what is below up.
 */
test("a streamed run of edits moves smoothly: steady label, no second fade, a slide after each decision", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openApp(page, {
    animations: true,
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(
    page,
    "Alpha line one is long enough to wrap in the panel when it is shown as a card.\n\nBeta line two.\n\nGamma.",
  );
  await page.evaluate(() => {
    type Send = (event: unknown) => void;
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
      __devNameCall: (blocks: unknown, args: object) => object;
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd !== "ai_agent_message") return original(cmd, args);
      const { message, onEvent, blocks } = args as {
        message: string;
        onEvent?: { onmessage?: Send };
        blocks: unknown;
      };
      const send: Send = (event) => onEvent?.onmessage?.(event);
      const steps: [number, () => void][] = [];
      const at = (ms: number, f: () => void) => steps.push([ms, f]);
      const words = (s: string) => s.split(/(?<=\s)/);
      // Thinking, in pieces.
      at(300, () => send({ type: "thinking", text: "" }));
      for (const w of words(
        "Weighing which lines need it. The first is long, the second short; capitals for both, Gamma goes.",
      ))
        at(40, () => send({ type: "thinking", text: w }));
      // A first bit of reply text.
      for (const w of words("I'll put the first two lines in capitals "))
        at(40, () => send({ type: "delta", text: w }));
      at(10, () => send({ type: "delta", text: "and drop Gamma." }));
      const turns: unknown[] = [];
      const lead = {
        kind: "Assistant",
        text: "I'll put the first two lines in capitals and drop Gamma.",
      };
      at(30, () => send({ type: "turn", turn: lead }));
      turns.push(lead);
      const calls = [
        {
          action: "replace",
          anchor:
            "Alpha line one is long enough to wrap in the panel when it is shown as a card.",
          text: "ALPHA LINE ONE IS LONG ENOUGH TO WRAP IN THE PANEL WHEN IT IS SHOWN AS A CARD.",
        },
        { action: "replace", anchor: "Beta line two.", text: "BETA LINE TWO." },
        { action: "delete", anchor: "Gamma." },
      ].map((edit, i) => ({
        id: `c${i}`,
        args: JSON.stringify(w.__devNameCall(blocks, edit)),
      }));
      for (const call of calls) {
        at(200, () =>
          send({ type: "toolStart", callId: call.id, name: "propose_edit" }),
        );
        for (let k = 0; k < call.args.length; k += 12) {
          const delta = call.args.slice(k, k + 12);
          at(25, () => send({ type: "toolArgsDelta", callId: call.id, delta }));
        }
        const turn = {
          kind: "ToolCall",
          call_id: call.id,
          name: "propose_edit",
          arguments: call.args,
        };
        const result = {
          kind: "ToolResult",
          call_id: call.id,
          output: "Edit proposed",
        };
        turns.push(turn, result);
        at(30, () => send({ type: "turn", turn }));
        at(30, () => send({ type: "turn", turn: result }));
      }
      for (const w of words(
        "Done: both lines are in capitals, and Gamma is gone.",
      ))
        at(40, () => send({ type: "delta", text: w }));
      const reply = {
        kind: "Assistant",
        text: "Done: both lines are in capitals, and Gamma is gone.",
      };
      turns.push(reply);
      at(30, () => send({ type: "turn", turn: reply }));
      return new Promise((resolve) => {
        const next = () => {
          const step = steps.shift();
          if (!step) {
            resolve([{ kind: "User", text: message }, ...turns]);
            return;
          }
          setTimeout(() => {
            step[1]();
            next();
          }, step[0]);
        };
        next();
      });
    };
    // Every frame: each transcript row's top, height and opacity.
    const frames: unknown[] = [];
    (window as unknown as { __frames: unknown[] }).__frames = frames;
    const t0 = performance.now();
    const tick = () => {
      const list = document.querySelector(
        ".agent-panel-view .inline-chat-messages",
      );
      if (list) {
        const base = list.getBoundingClientRect().top;
        frames.push({
          t: Math.round(performance.now() - t0),
          scroll: Math.round((list as HTMLElement).scrollTop),
          rows: Array.from(list.children).map((el) => {
            const r = el.getBoundingClientRect();
            const name =
              (el.className || el.tagName)
                .toString()
                .split(" ")
                .slice(0, 2)
                .join(".") +
              "#" +
              (el.textContent ?? "").replace(/\s+/g, " ").slice(0, 18);
            return [
              name,
              Math.round(r.top - base),
              Math.round(r.height),
              Number(getComputedStyle(el).opacity).toFixed(2),
            ];
          }),
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Capitals for the first two, drop Gamma");
  await composer.press("Enter");
  const accept = page.locator(".agent-proposal-group-rows .pending-pick-take");
  await accept.nth(2).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  for (let left = 3; left > 0; left--) {
    await accept.first().click();
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(800);
  type Row = [string, number, number, string];
  const frames = await page.evaluate(
    () =>
      (window as unknown as { __frames: { t: number; rows: Row[] }[] })
        .__frames,
  );
  // The row at the end: once it says the edit is being written, it doesn't
  // go back to "Thinking" until the run's edits are all in.
  const labels = frames
    .map((f) => f.rows.find(([name]) => name.startsWith("agent-thinking"))?.[0])
    .filter((name): name is string => !!name)
    .map((name) => name.split("#")[1]);
  const firstWriting = labels.indexOf("正在写修改");
  expect(firstWriting).toBeGreaterThan(-1);
  const after = labels.slice(firstWriting);
  const lastWriting = after.lastIndexOf("正在写修改");
  expect(after.slice(0, lastWriting).filter((l) => l === "思考中")).toEqual([]);
  // The group, from its first frame, is at full strength: it took a card's
  // place.
  const group = frames
    .flatMap((f) => f.rows)
    .find(([name]) => name.startsWith("agent-proposal.agent-proposal-group"));
  expect(group?.[3]).toBe("1.00");
  // The reply under the cards moves only in slides: each run of moving frames
  // spans three or more, none covering nearly all of it (--ease-out's first
  // frame is near half; a jump is all of it).
  const tops = frames
    .map((f) => f.rows.find(([name]) => name.includes("#Done:"))?.[1])
    .filter((top): top is number => top !== undefined);
  const steps = tops.slice(1).map((top, i) => Math.abs(top - tops[i]));
  const moves: number[][] = [];
  for (const step of steps)
    if (step === 0) moves.push([]);
    else (moves.at(-1) ?? moves[moves.push([]) - 1]).push(step);
  const slides = moves.filter((m) => m.reduce((a, b) => a + b, 0) > 20);
  expect(slides.length).toBeGreaterThan(0);
  for (const m of slides) {
    expect(m.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...m)).toBeLessThanOrEqual(
      0.8 * m.reduce((a, b) => a + b, 0),
    );
  }
});
