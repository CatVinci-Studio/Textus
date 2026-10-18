import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "./document-tools.mjs";
test("Harness image prompts are bounded before reaching the paid host bridge", async () => {
  const tools = [];
  apply(
    { tools: { register: (tool) => tools.push(tool) } },
    { images: true, writable: true },
  );
  const generate = tools.find((tool) => tool.name === "generate_image");
  await assert.rejects(
    generate.execute({
      prompt: "x".repeat(1501),
      anchor: "A paragraph",
      alt: "Image",
    }),
    /1500/,
  );
  const readOnly = [];
  apply(
    { tools: { register: (tool) => readOnly.push(tool) } },
    { images: true, writable: false },
  );
  assert.equal(
    readOnly.some((tool) => tool.name === "generate_image"),
    false,
  );
});
