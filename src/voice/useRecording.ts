import { SilenceStop } from "./silence";
import { useCallback, useEffect, useRef, useState } from "react";
import { media } from "../platform/ipc";
import { errorText } from "../utils/error-text";
import { recordingWav } from "./recording-wav";

export const MAX_RECORDING_MS = 120_000;
export const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
type RecordingState =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "recorded"
  | "transcribing"
  | "review"
  | "error";

function encodeAudio(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Cannot read recording"));
    reader.readAsDataURL(blob);
  });
}

/** No upload happens until stopAndTranscribe/transcribe is explicitly called. */
export function useRecording(
  active: boolean,
  language: string | null,
  provider?: string,
  autoStop = false,
) {
  const [state, setState] = useState<RecordingState>("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const blob = useRef<Blob | null>(null);
  const generation = useRef(0);
  const request = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shouldUpload = useRef(false);
  const audioContext = useRef<AudioContext | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );
  const release = useCallback(() => {
    clearTimeout(timer.current);
    clearInterval(silenceTimer.current);
    void audioContext.current?.close().catch(() => {});
    audioContext.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);
  const cancel = useCallback(() => {
    generation.current++;
    shouldUpload.current = false;
    if (recorder.current?.state !== "inactive") recorder.current?.stop();
    recorder.current = null;
    release();
    chunks.current = [];
    blob.current = null;
    if (request.current) void media.cancel(request.current).catch(() => {});
    request.current = null;
    setText("");
    setError(null);
    setState("idle");
  }, [release]);
  useEffect(() => {
    if (!active) cancel();
    return cancel;
  }, [active, cancel]);

  const transcribe = useCallback(async () => {
    const audio = blob.current;
    const token = generation.current;
    if (!audio) return;
    if (!audio.size || audio.size > MAX_RECORDING_BYTES) {
      setError("Recording must be between 1 byte and 25 MiB.");
      setState("error");
      blob.current = null;
      return;
    }
    setState("transcribing");
    setError(null);
    try {
      const upload =
        provider && provider !== "system" ? await recordingWav(audio) : audio;
      if (token !== generation.current) return;
      const data = await encodeAudio(upload);
      if (token !== generation.current) return;
      const requestId = crypto.randomUUID();
      request.current = requestId;
      const result = await media.transcribe(
        requestId,
        data,
        upload.type,
        language,
      );
      if (token !== generation.current) return;
      setText(result);
      setState("review");
    } catch (err) {
      if (token === generation.current) {
        setError(errorText(err));
        setState("error");
      }
    } finally {
      if (token === generation.current) {
        blob.current = null;
        request.current = null;
      }
    }
  }, [language, provider]);

  const start = useCallback(async () => {
    if (!active) return;
    cancel();
    const token = generation.current;
    setState("requesting_permission");
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "Microphone recording is not available on this device.",
        );
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (token !== generation.current) {
        input.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = input;
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recording = new MediaRecorder(
        input,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.current = recording;
      let bytes = 0;
      let exceeded = false;
      recording.ondataavailable = (event) => {
        if (token !== generation.current || exceeded) return;
        bytes += event.data.size;
        if (bytes > MAX_RECORDING_BYTES) {
          exceeded = true;
          chunks.current = [];
          shouldUpload.current = false;
          setError(
            "Recording exceeded 25 MiB. Please record a shorter segment.",
          );
          setState("error");
          if (recording.state !== "inactive") recording.stop();
          release();
          return;
        }
        if (event.data.size) chunks.current.push(event.data);
      };
      recording.onstop = () => {
        release();
        if (token !== generation.current || exceeded) return;
        blob.current = new Blob(chunks.current, {
          type: recording.mimeType || mime || "audio/webm",
        });
        chunks.current = [];
        recorder.current = null;
        if (shouldUpload.current) void transcribe();
        else setState("recorded");
      };
      recording.onerror = () => {
        if (token !== generation.current) return;
        cancel();
        setError("Recording failed. Check the microphone and try again.");
        setState("error");
      };
      if (autoStop) {
        const context = new AudioContext();
        audioContext.current = context;
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(input).connect(analyser);
        await context.resume();
        if (token !== generation.current) {
          void context.close().catch(() => {});
          return;
        }
        const samples = new Float32Array(analyser.fftSize);
        const silence = new SilenceStop(performance.now());
        silenceTimer.current = setInterval(() => {
          if (token !== generation.current) return;
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(
            samples.reduce((sum, x) => sum + x * x, 0) / samples.length,
          );
          const stop = silence.sample(performance.now(), rms);
          if (!stop) return;
          shouldUpload.current = stop === "speech";
          if (recording.state !== "inactive") recording.stop();
          release();
          if (stop === "empty") cancel();
        }, 100);
      }
      recording.start(1000);
      setState("recording");
      timer.current = setTimeout(
        () => {
          shouldUpload.current = autoStop;
          if (recording.state !== "inactive") recording.stop();
          release();
        },
        provider === "azure-speech" ? 60_000 : MAX_RECORDING_MS,
      );
    } catch (err) {
      if (token !== generation.current) return;
      release();
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : err instanceof DOMException && err.name === "NotFoundError"
            ? "No microphone was found."
            : errorText(err),
      );
      setState("error");
    }
  }, [active, autoStop, cancel, release, transcribe, provider]);
  const stopAndTranscribe = useCallback(() => {
    shouldUpload.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    release();
  }, [release]);
  return {
    state,
    text,
    setText,
    error,
    start,
    cancel,
    transcribe,
    stopAndTranscribe,
  };
}
