import type { Page } from "@playwright/test";

/**
 * The backend streaming `calls` (propose_edit arguments) in `chunk`-sized
 * argument fragments every `every` ms, then the turns. A call written as
 * the words it is about is named by their block first, as a model names
 * it, and settled as the backend settles it (src/dev/settle-calls.ts).
 * `hold`: the stream stops after this many fragments of the arguments as
 * given (before naming their block) and waits for a stop (ai_cancel).
 */
export async function streamRevise(
  page: Page,
  calls: { id: string; args: object }[],
  options: { chunk?: number; every?: number; hold?: number } = {},
) {
  await page.evaluate(
    ({ calls, chunk, every, hold }) => {
      type Send = (event: unknown) => void;
      const w = window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown) => Promise<unknown>;
        };
        __devNameCall: (blocks: unknown, args: object) => object;
        __devSettle: (blocks: unknown, name: string, args: string) => string;
      };
      const internals = w.__TAURI_INTERNALS__;
      const original = internals.invoke;
      let cancel: (() => void) | null = null;
      internals.invoke = (cmd, args) => {
        if (cmd === "ai_cancel") {
          cancel?.();
          return Promise.resolve(null);
        }
        if (cmd !== "ai_agent_message") return original(cmd, args);
        const { message, onEvent, blocks } = args as {
          message: string;
          onEvent?: { onmessage?: Send };
          blocks: unknown;
        };
        const send: Send = (event) => onEvent?.onmessage?.(event);
        const steps: (() => void)[] = [];
        const turns: unknown[] = [];
        let fragments = 0;
        // The fragment `hold` stops at, in the named arguments: as far into
        // them as `hold` fragments reach into the first call's own.
        let holdAt = hold;
        for (const call of calls) {
          const json = JSON.stringify(w.__devNameCall(blocks, call.args));
          if (hold !== null && call === calls[0])
            holdAt = Math.ceil(
              (hold * chunk + json.length - JSON.stringify(call.args).length) /
                chunk,
            );
          steps.push(() =>
            send({ type: "toolStart", callId: call.id, name: "propose_edit" }),
          );
          for (let from = 0; from < json.length; from += chunk) {
            const delta = json.slice(from, from + chunk);
            steps.push(() => {
              fragments++;
              send({ type: "toolArgsDelta", callId: call.id, delta });
            });
          }
          const turn = {
            kind: "ToolCall",
            call_id: call.id,
            name: "propose_edit",
            arguments: w.__devSettle(blocks, "propose_edit", json),
          };
          const result = {
            kind: "ToolResult",
            call_id: call.id,
            output: "Edit proposed",
          };
          turns.push(turn, result);
          steps.push(() => send({ type: "turn", turn }));
          steps.push(() => send({ type: "turn", turn: result }));
        }
        const reply = { kind: "Assistant", text: "Tightened." };
        turns.push(reply);
        steps.push(() => send({ type: "turn", turn: reply }));
        return new Promise((resolve, reject) => {
          let timer = 0;
          cancel = () => {
            window.clearTimeout(timer);
            reject("cancelled");
          };
          const next = () => {
            if (holdAt !== null && fragments >= holdAt) return;
            const step = steps.shift();
            if (!step) {
              resolve([{ kind: "User", text: message }, ...turns]);
              return;
            }
            step();
            timer = window.setTimeout(next, every);
          };
          next();
        });
      };
    },
    {
      calls,
      chunk: options.chunk ?? 6,
      every: options.every ?? 30,
      hold: options.hold ?? null,
    },
  );
}

/**
 * A short story of our own in modern Chinese, and the same story rewritten
 * in classical Chinese - the rewrite folds the three lines of dialogue into
 * one, so one change's original runs over three paragraphs.
 */
export const STORY = [
  "雨下了一整夜，楼道里的灯坏了两盏。",
  "林阿姨把那台旧收音机搬到窗边，打开了工具盒。",
  "收音机是她父亲留下的，外壳已经发黄，旋钮也松了。",
  "她儿子站在门口看了一会儿，说这东西早就该扔了。",
  "她没有回头，只是用手按住了螺丝刀。",
  "“别打开后盖。”",
  "“里面全是灰。”",
  "“小心会触电的。”",
  "儿子说完这些，又觉得自己说多了，就回房间去了。",
  "林阿姨拧下第一颗螺丝，听见窗外的雨停了。",
].join("\n\n");

export const STORY_CLASSICAL = [
  "雨下一整夜，楼道灯坏两盏。",
  "林阿姨移旧收音机至窗边，启工具盒。",
  "收音机乃其父留下，外壳已黄，旋钮亦松。",
  "其子立门口看之，曰此东西早该扔。",
  "妇不回头，以手按其螺丝刀。",
  "“勿开后盖，里面全是灰，小心触电。”",
  "儿子说完，自觉说多，遂回房间。",
  "林阿姨拧下第一颗螺丝，闻窗外雨停。",
].join("\n\n");
