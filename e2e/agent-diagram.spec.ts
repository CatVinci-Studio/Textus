import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

// A ```mermaid block Textus AI proposes is drawn as its diagram while it
// waits for a decision - it used to show as one line of inline code until
// Accept - and while it streams in, the diagram grows a statement at a time,
// only the new parts fading in. Accept keeps the drawing, Reject and undo
// take it away with the proposal.

const DIAGRAM = "```mermaid\nflowchart LR\n  A[Start] --> B[Finish]\n```";
const editor = '[data-active-tab="true"] .ProseMirror';
const pending = `${editor} .pending-insert .pending-diagram`;
/** The diagrams of the document itself. */
const drawn = `${editor} > .mermaid-preview > svg`;

function proposal(args: object) {
  return [
    { kind: "User", text: "go" },
    {
      kind: "ToolCall",
      call_id: "d1",
      name: "propose_edit",
      arguments: JSON.stringify(args),
    },
    { kind: "ToolResult", call_id: "d1", output: "Edit proposed" },
    { kind: "Assistant", text: "Drew it." },
  ];
}

async function open(page: Page, diagramEngine = "mermaid") {
  await openApp(page, {
    settings: { language: "en", diagramEngine },
    storage: { "levis-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, "The first paragraph.\n\nThe second paragraph.");
}

async function send(page: Page, message: string) {
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill(message);
  await composer.press("Enter");
}

const actions = (page: Page) =>
  page.locator(".agent-proposal-actions .inline-chat-action");

async function proposeDiagram(page: Page) {
  await mockInvoke(page, {
    ai_agent_message: proposal({
      action: "insert_after",
      anchor: "The first paragraph.",
      text: `Here is the flow:\n\n${DIAGRAM}`,
    }),
  });
  await send(page, "Draw the flow");
}

for (const [engine, svg] of [
  ["mermaid", "svg:not(.pele)"],
  ["pele", "svg.pele"],
] as const) {
  test(`a proposed diagram is drawn by ${engine} before Accept and stays after it`, async ({
    page,
  }) => {
    await open(page, engine);
    await proposeDiagram(page);
    await expect(page.locator(`${pending} > ${svg}`)).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(page.locator(`${editor} .pending-insert`)).toContainText(
      "Here is the flow:",
    );
    await expect(page.locator(drawn)).toHaveCount(0);

    await actions(page).filter({ hasText: "Accept" }).click();
    await expect(page.locator(pending)).toHaveCount(0);
    await expect(page.locator(drawn)).toHaveCount(1);
    await expect(
      page.locator(`${editor} > .mermaid-preview > ${svg}`),
    ).toHaveCount(1);

    // Undo puts the proposal back, diagram and all.
    await page.locator(editor).focus();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator(`${pending} > ${svg}`)).toHaveCount(1);
    await expect(page.locator(drawn)).toHaveCount(0);
  });
}

test("rejecting a proposed diagram takes the drawing away with it", async ({
  page,
}) => {
  await open(page);
  await proposeDiagram(page);
  await expect(page.locator(`${pending} > svg`)).toHaveCount(1, {
    timeout: 10_000,
  });
  await actions(page).filter({ hasText: "Reject" }).click();
  await expect(page.locator(pending)).toHaveCount(0);
  await expect(page.locator(`${editor} svg`)).toHaveCount(0);
  await expect(page.locator(`${editor} p`)).toHaveText([
    "The first paragraph.",
    "The second paragraph.",
  ]);
});

/** Streams the proposal a line of its text at a time, the next line when
 *  the test calls `__nextLine()`. */
async function streamLines(page: Page, lines: string[]) {
  await page.evaluate((lines) => {
    type Send = (event: unknown) => void;
    const w = window as unknown as {
      __nextLine?: () => void;
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd !== "ai_agent_message") return original(cmd, args);
      const { message, onEvent } = args as {
        message: string;
        onEvent?: { onmessage?: Send };
      };
      const send: Send = (event) => onEvent?.onmessage?.(event);
      const text = lines.join("");
      const json = JSON.stringify({
        action: "insert_after",
        anchor: "The first paragraph.",
        text,
      });
      // The argument JSON up to the end of each line of `text`.
      const cuts: number[] = [];
      let sent = 0;
      for (const line of lines) {
        sent += line.length;
        cuts.push(JSON.stringify(text.slice(0, sent)).length - 1);
      }
      const head = json.indexOf('"text":"') + '"text":"'.length;
      let from = 0;
      send({ type: "toolStart", callId: "s1", name: "propose_edit" });
      return new Promise((resolve) => {
        w.__nextLine = () => {
          const cut = cuts.shift();
          const to = cut === undefined ? json.length : head + cut - 1;
          send({
            type: "toolArgsDelta",
            callId: "s1",
            delta: json.slice(from, to),
          });
          from = to;
          if (cut !== undefined) return;
          const turns = [
            {
              kind: "ToolCall",
              call_id: "s1",
              name: "propose_edit",
              arguments: json,
            },
            { kind: "ToolResult", call_id: "s1", output: "Edit proposed" },
            { kind: "Assistant", text: "Drew it." },
          ];
          for (const turn of turns) send({ type: "turn", turn });
          resolve([{ kind: "User", text: message }, ...turns]);
        };
      });
    };
  }, lines);
}

const nextLine = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __nextLine: () => void }).__nextLine(),
  );

for (const [engine, node] of [
  ["mermaid", (id: string) => `g.node[id*="-flowchart-${id}-"]`],
  ["pele", (id: string) => `g.pele-node[data-id="${id}"]`],
] as const) {
  test(`a streaming diagram grows a statement at a time with ${engine}, only new parts fading in`, async ({
    page,
  }) => {
    await open(page, engine);
    await streamLines(page, [
      "```mermaid\n",
      "flowchart LR\n",
      "  A[Start] --> B[Middle]\n",
      "  B --> C[Finish]\n",
      "```",
    ]);
    await send(page, "Draw the flow");
    for (let i = 0; i < 3; i++) await nextLine(page);
    const diagram = page.locator(`${pending} > svg`);
    await expect(diagram.locator(node("B"))).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(diagram.locator(node("C"))).toHaveCount(0);

    await nextLine(page);
    await expect(diagram.locator(node("C"))).toHaveCount(1);
    // What was there already stays still; the node just added fades in.
    await expect(
      diagram.locator(`${node("C")}.diagram-part-enter`),
    ).toHaveCount(1);
    await expect(
      diagram.locator(`${node("A")}.diagram-part-enter`),
    ).toHaveCount(0);
    await expect(
      diagram.locator(`${node("B")}.diagram-part-enter`),
    ).toHaveCount(0);

    // The closing fence and the end of the call: decidable, then accepted.
    await nextLine(page);
    await nextLine(page);
    await actions(page).filter({ hasText: "Accept" }).click();
    await expect(page.locator(pending)).toHaveCount(0);
    await expect(page.locator(drawn).locator(node("C"))).toHaveCount(1);
  });
}
