import { expect, it } from "vitest";
import { speechChunks } from "./speech-chunks";
it("chunks paragraphs without splitting Unicode characters or exceeding 600 characters", () => {
  const text = "中文🙂".repeat(2500) + "。\n\nEnglish paragraph.";
  const chunks = speechChunks(text);
  expect(chunks.every((chunk) => Array.from(chunk.text).length <= 600)).toBe(
    true,
  );
  expect(
    chunks
      .map((chunk) => chunk.text)
      .join("")
      .replace(/\n\n/g, ""),
  ).toBe(text.replace(/\n\n/g, ""));
  expect(chunks.at(-1)?.text).toContain("English paragraph.");
  for (const chunk of chunks)
    expect(text.slice(chunk.start, chunk.end)).toBe(chunk.text);
  expect(speechChunks(" \n\n\t")).toEqual([]);
});
it("merges short neighbouring paragraphs into one request within the limit", () => {
  const text = "# Title\n\nA line.\n\n- item\n\n" + "x".repeat(590);
  const chunks = speechChunks(text);
  expect(chunks.map((c) => c.text)).toEqual([
    "# Title\n\nA line.\n\n- item",
    "x".repeat(590),
  ]);
  for (const chunk of chunks)
    expect(text.slice(chunk.start, chunk.end)).toBe(chunk.text);
});
