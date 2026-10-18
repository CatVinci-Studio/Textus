import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./cli.mjs";

for (const engine of ["codex", "claude-code"]) {
  test(`${engine} routes authorized illustrations through Host and keeps Ask read-only`, async () => {
    const home = await mkdtemp(join(tmpdir(), "textus-cli-test-"));
    try {
      const executable = join(home, "fixture");
      await writeFile(
        executable,
        `#!/usr/bin/env node
let input = ''; for await (const chunk of process.stdin) input += chunk;
const result = {text:'Draft',proposals:[],imageRequests:[{prompt:'A calm forest at dawn',anchor:'Forest paragraph.',alt:'Forest'}]};
const codex = process.argv.includes('exec');
process.stdout.write(JSON.stringify(codex ? {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(result)}} : {type:'result',structured_output:result})+'\\n');
`,
        { mode: 0o700 },
      );
      let calls = 0;
      for (const mode of ["create", "ask"]) {
        const events = [];
        await runCli(
          {
            engine,
            mode,
            executable,
            enableImages: true,
            message: "Illustrate",
            document: "Forest paragraph.",
          },
          home,
          (event) => events.push(event),
          async (name, args) => {
            calls++;
            assert.equal(name, "generate_image");
            assert.equal(args.anchor, "Forest paragraph.");
            return "Image job queued";
          },
        );
        const turns = events.at(-1).result;
        const call = turns.find((t) => t.kind === "ToolCall");
        if (mode === "create") {
          assert.equal(call.name, "generate_image");
          assert.ok(call.call_id);
          assert.equal(
            turns.find((t) => t.kind === "ToolResult").call_id,
            call.call_id,
          );
        } else assert.equal(call, undefined);
      }
      assert.equal(calls, 1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
}
