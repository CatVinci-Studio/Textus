import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { responseTurns } from "./protocol.mjs";

test("read-only native engine output cannot create document proposals", () => {
  assert.deepEqual(
    responseTurns(
      {
        text: "Advice",
        proposals: [
          { action: "append", anchor: "", text: "Must not apply", reason: "" },
        ],
      },
      false,
    ),
    [{ kind: "Assistant", text: "Advice" }],
  );
  assert.throws(() =>
    responseTurns(
      { text: "", proposals: [{ action: "shell", text: "bad", anchor: "" }] },
      true,
    ),
  );
});
test(
  "official Harness completes a real tool loop against a deterministic provider",
  { timeout: 45000 },
  async () => {
    let requests = 0;
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body);
      assert.ok(data.tools.some((t) => t.function.name === "read_document"));
      assert.ok(data.tools.some((t) => t.function.name === "propose_edit"));
      assert.ok(
        !data.tools.some((t) =>
          /bash|write_file|edit_file/.test(t.function.name),
        ),
      );
      requests++;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const delta =
        requests === 1
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call-test",
                  type: "function",
                  function: {
                    name: "propose_edit",
                    arguments: JSON.stringify({
                      action: "append",
                      text: "A test draft.",
                      reason: "Requested",
                    }),
                  },
                },
              ],
            }
          : { role: "assistant", content: "Draft is ready for review." };
      for (const value of [
        {
          id: "test",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta, finish_reason: null }],
        },
        {
          id: "test",
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: requests === 1 ? "tool_calls" : "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        },
      ])
        res.write(`data: ${JSON.stringify(value)}\n\n`);
      res.end("data: [DONE]\n\n");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const child = spawn(process.execPath, ["harness/host.mjs"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (x) => (stdout += x));
    child.stderr.on("data", (x) => (stderr += x));
    child.stdin.end(
      JSON.stringify({
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        apiKey: "test",
        model: "fixture",
        document: "Original",
        mode: "create",
        message: "Append a test draft.",
        history: [],
      }) + "\n",
    );
    try {
      const code = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", resolve);
      });
      assert.equal(code, 0, stdout + stderr);
      const result = stdout
        .trim()
        .split("\n")
        .map((x) => JSON.parse(x))
        .find((x) => x.result)?.result;
      assert.ok(
        result?.some((t) => t.kind === "ToolCall" && t.name === "propose_edit"),
        stdout,
      );
      assert.ok(
        result?.some(
          (t) =>
            t.kind === "ToolResult" && t.output.startsWith("Edit proposed"),
        ),
        stdout,
      );
      const call = result.find((turn) => turn.kind === "ToolCall");
      const toolResult = result.find((turn) => turn.kind === "ToolResult");
      assert.ok(typeof call.call_id === "string" && call.call_id.length > 0);
      assert.equal(
        toolResult.call_id,
        call.call_id,
        "every tool result must retain the official call identity required by Rust",
      );
      assert.equal(requests, 2);
    } finally {
      child.kill("SIGKILL");
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
