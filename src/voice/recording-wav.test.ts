import { expect, it } from "vitest";
import { pcm16Wav } from "./recording-wav";

it("encodes mono PCM WAV with bounded clipped signed samples and correct header", () => {
  const wav = pcm16Wav(new Float32Array([-2, -1, 0, 1, 2]), 16000);
  const bytes = new DataView(wav);
  expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
  expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
  expect(bytes.getUint32(24, true)).toBe(16000);
  expect(bytes.getUint16(22, true)).toBe(1);
  expect(bytes.getUint32(40, true)).toBe(10);
  expect(bytes.getInt16(44, true)).toBe(-32768);
  expect(bytes.getInt16(48, true)).toBe(0);
  expect(bytes.getInt16(52, true)).toBe(32767);
});
