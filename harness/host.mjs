import { createServer } from "node:http";
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { runCli } from "./cli.mjs";
import { sessionTurn } from "./protocol.mjs";
const input = createInterface({ input: process.stdin });
const request = JSON.parse((await input[Symbol.asyncIterator]().next()).value);

const home = request.home ?? (await mkdtemp(join(tmpdir(), "textus-harness-")));
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
let runtime;
let bridge;
const callbacks = new Map();
input.on("line", (line) => {
  try {
    const value = JSON.parse(line);
    const resolve = callbacks.get(value.id);
    if (resolve) {
      callbacks.delete(value.id);
      resolve(value.output);
    }
  } catch {
    /* parent rejects malformed input */
  }
});
let shuttingDown = false;
async function close() {
  if (shuttingDown) return;
  shuttingDown = true;
  await runtime?.close();
  input.close();
  bridge?.closeAllConnections();
  await new Promise((resolve) => (bridge ? bridge.close(resolve) : resolve()));
  await rm(home, { recursive: true, force: true });
}
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    void close().finally(() => process.exit(0));
  });
try {
  if (request.engine && request.engine !== "harness") {
    await runCli(request, home, emit);
  } else {
    const bridgeToken = crypto.randomUUID();
    bridge = createServer(async (req, res) => {
      if (req.headers.authorization !== "Bearer " + bridgeToken) {
        res.writeHead(403).end();
        return;
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 16000) {
          res.writeHead(413).end();
          return;
        }
      }
      const id = crypto.randomUUID();
      const output = await new Promise((resolve) => {
        callbacks.set(id, resolve);
        emit({ tool: { id, name: "generate_image", arguments: body } });
      });
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ output }));
    });
    await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
    const writable = ["create", "edit"].includes(request.mode);
    const disabled = [
      "llm-deepseek",
      "tool-fs",
      "tool-working-directory",
      "terminal-bash",
      "terminal-pwsh",
      "persistent-bash",
      "persistent-pwsh",
      "sessions",
    ];
    const patch = [
      ...disabled.map((id) => ({ id, disabled: true })),
      {
        insert: [
          {
            id: "textus-provider",
            name: "@deepseek-ai/dsh-llm-pi-ai",
            config: {
              providers: {
                textus: {
                  apiKeyEnv: "TEXTUS_LLM_KEY",
                  api: "openai-completions",
                  baseURL: request.baseUrl,
                  models: [
                    {
                      id: request.model,
                      name: request.model,
                      contextWindow: 200000,
                    },
                  ],
                  retryPolicy: { mode: "normal", maxRetries: 1 },
                },
              },
            },
          },
          {
            id: "textus-tools",
            name: fileURLToPath(
              new URL("./document-tools.mjs", import.meta.url),
            ),
            config: { writable, images: request.enableImages === true },
          },
        ],
      },
    ];
    const patchPath = join(home, "textus.patch.yml");
    await writeFile(patchPath, JSON.stringify(patch), { mode: 0o600 });
    runtime = new DeepSeekHarness({
      profile: "sdk-minimal",
      patches: [patchPath],
      dshHome: home,
      processCwd: home,
      cwd: home,
      provider: "textus",
      model: request.model,
      initializeTimeoutMs: 30000,
      env: {
        ...process.env,
        TEXTUS_LLM_KEY: request.apiKey ?? "",
        TEXTUS_TOOL_TOKEN: bridgeToken,
        TEXTUS_TOOL_URL: `http://127.0.0.1:${bridge.address().port}`,
        TEXTUS_DOCUMENT: request.document,
        DSH_SYSTEM_PROMPT:
          "You are Textus, a writing assistant. Use read_document and propose_edit for document work. Proposals require user review; never claim they were applied. Follow the user language. Mode: " +
          request.mode,
      },
    });
    await runtime.start();
    if (request.checkOnly) {
      emit({ ready: true });
    } else {
      const turns = [{ kind: "User", text: request.message, images: [] }];
      const prompt = `Conversation context (historical proposals may not have been accepted):\n${JSON.stringify(request.history ?? [])}\nCurrent user request:\n${request.message}`;
      await runtime.run(prompt, {
        onNotification(n) {
          if (n.method === "session.event") {
            const turn = sessionTurn(n.params.event);
            if (turn) {
              turns.push(turn);
              emit({ event: { type: "turn", turn } });
            }
          }
        },
      });
      emit({ result: turns });
    }
  }
} catch (error) {
  emit({
    error: String(error.message ?? error).replaceAll(
      request.apiKey || "__NO_KEY__",
      "[redacted]",
    ),
  });
  process.exitCode = 1;
} finally {
  await close();
}
