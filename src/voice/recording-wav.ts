/** PCM16 mono WAV; no external service or codec process is involved. */
export function pcm16Wav(
  samples: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(
      44 + i * 2,
      Math.round(value * (value < 0 ? 32768 : 32767)),
      true,
    );
  }
  return buffer;
}

export async function recordingWav(blob: Blob): Promise<Blob> {
  const context = new OfflineAudioContext(1, 1, 16000);
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  if (!decoded.length || decoded.duration > 121)
    throw new Error("Record at most 120 seconds for MiniMax transcription.");
  const mono = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const samples = decoded.getChannelData(channel);
    for (let i = 0; i < mono.length; i++)
      mono[i] += samples[i] / decoded.numberOfChannels;
  }
  return new Blob([pcm16Wav(mono, decoded.sampleRate)], { type: "audio/wav" });
}
