import { expect, it } from "vitest";
import { speechChunks } from "./speech-chunks";
it("chunks paragraphs without splitting Unicode characters or exceeding 600 characters", () => {
  const text = "中文🙂".repeat(2500) + "。\n\nEnglish paragraph.";
  const chunks = speechChunks(text);
  expect(chunks.every((chunk) => Array.from(chunk.text).length <= 600)).toBe(
    true,
  );
  expect(chunks.map((chunk) => chunk.text).join("")).toBe(
    text.replace(/\n\n/g, ""),
  );
  expect(chunks.at(-1)?.paragraph).toBe(1);
  for (const chunk of chunks)
    expect(text.slice(chunk.start, chunk.end)).toBe(chunk.text);
  expect(speechChunks(" \n\n\t")).toEqual([]);
});
