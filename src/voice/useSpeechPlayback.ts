import { useCallback, useEffect, useRef, useState } from "react";
import { media } from "../platform/ipc";
import { speechChunks, type SpeechChunk } from "./speech-chunks";
import { useLatest } from "../utils/hooks/useLatest";
import { errorText } from "../utils/error-text";

const START_EVENT = "textus:speech-start";
type PlaybackState = "idle" | "loading" | "playing" | "paused" | "error";

/** One bounded synthesis at a time; stopping invalidates late network results. */
export function useSpeechPlayback(
  active: boolean,
  onChunk?: (chunk: SpeechChunk) => boolean | void,
  onStop?: () => void,
) {
  const [state, setState] = useState<PlaybackState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [rate, setRateState] = useState(1);
  const [position, setPosition] = useState(0);
  const [total, setTotal] = useState(0);
  const id = useRef(crypto.randomUUID());
  const generation = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const request = useRef<string | null>(null);
  const queue = useRef<SpeechChunk[]>([]);
  const index = useRef(0);
  const currentVoice = useRef("");
  const paused = useRef(false);
  const rateRef = useRef(rate);
  const chunkRef = useLatest(onChunk);
  const stopRef = useLatest(onStop);
  const clearAudio = useCallback(() => {
    if (audio.current) {
      audio.current.onended = null;
      audio.current.onerror = null;
      audio.current.pause();
      audio.current.removeAttribute("src");
      audio.current.load();
      audio.current = null;
    }
    if (audioUrl.current) {
      URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = null;
    }
  }, []);
  const stop = useCallback(() => {
    generation.current++;
    if (request.current) void media.cancel(request.current).catch(() => {});
    request.current = null;
    paused.current = false;
    clearAudio();
    setState("idle");
    setError(null);
    stopRef.current?.();
  }, [clearAudio, stopRef]);
  useEffect(() => {
    if (!active) stop();
    return stop;
  }, [active, stop]);
  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id.current) stop();
    };
    window.addEventListener(START_EVENT, listener);
    return () => window.removeEventListener(START_EVENT, listener);
  }, [stop]);

  const playChunk = useCallback(
    async function playChunk(
      at: number,
      token: number,
      voice: string,
    ): Promise<void> {
      if (token !== generation.current) return;
      clearAudio();
      const chunk = queue.current[at];
      if (!chunk) {
        setState("idle");
        stopRef.current?.();
        return;
      }
      if (chunkRef.current?.(chunk) === false) {
        stop();
        setError(
          "The document changed. Restart reading from the current text.",
        );
        setState("error");
        return;
      }
      index.current = at;
      setPosition(at + 1);
      setState(paused.current ? "paused" : "loading");
      const requestId = crypto.randomUUID();
      request.current = requestId;
      try {
        const result = await media.synthesize(requestId, chunk.text, voice);
        if (token !== generation.current) return;
        if (chunkRef.current?.(chunk) === false) {
          stop();
          setError(
            "The document changed. Restart reading from the current text.",
          );
          setState("error");
          return;
        }
        request.current = null;
        const bytes = Uint8Array.from(atob(result.dataBase64), (c) =>
          c.charCodeAt(0),
        );
        audioUrl.current = URL.createObjectURL(
          new Blob([bytes], { type: result.mime }),
        );
        const player = new Audio(audioUrl.current);
        audio.current = player;
        player.playbackRate = rateRef.current;
        player.onended = () => {
          void playChunk(at + 1, token, voice);
        };
        player.onerror = () => {
          if (token === generation.current) {
            clearAudio();
            setError(
              "Cannot play the synthesized audio. Retry this paragraph.",
            );
            setState("error");
            stopRef.current?.();
          }
        };
        if (paused.current) {
          setState("paused");
          return;
        }
        await player.play();
        if (token === generation.current)
          setState(paused.current ? "paused" : "playing");
      } catch (err) {
        if (token === generation.current) {
          request.current = null;
          clearAudio();
          setError(errorText(err));
          setState("error");
          stopRef.current?.();
        }
      }
    },
    [clearAudio, chunkRef, stopRef, stop, rateRef],
  );
  const start = useCallback(
    (text: string, voice: string) => {
      if (!active) return;
      stop();
      queue.current = speechChunks(text);
      setTotal(queue.current.length);
      currentVoice.current = voice;
      if (!queue.current.length) return;
      window.dispatchEvent(
        new CustomEvent(START_EVENT, { detail: id.current }),
      );
      void playChunk(0, generation.current, voice);
    },
    [active, stop, playChunk],
  );
  const pause = useCallback(() => {
    paused.current = true;
    audio.current?.pause();
    setState("paused");
  }, []);
  const resume = useCallback(async () => {
    const chunk = queue.current[index.current];
    if (chunk && chunkRef.current?.(chunk) === false) {
      stop();
      setError("The document changed. Restart reading from the current text.");
      setState("error");
      return;
    }
    paused.current = false;
    const player = audio.current;
    if (!player) {
      setState("loading");
      return;
    }
    const token = generation.current;
    try {
      await player.play();
      if (token === generation.current)
        setState(paused.current ? "paused" : "playing");
    } catch (err) {
      if (token === generation.current) {
        setError(errorText(err));
        setState("error");
      }
    }
  }, [chunkRef, stop]);
  const setRate = useCallback((value: number) => {
    const bounded = Math.max(0.5, Math.min(2, value));
    rateRef.current = bounded;
    setRateState(bounded);
    if (audio.current) audio.current.playbackRate = bounded;
  }, []);
  const retry = useCallback(() => {
    setError(null);
    void playChunk(index.current, generation.current, currentVoice.current);
  }, [playChunk]);
  return {
    state,
    error,
    rate,
    setRate,
    position,
    total,
    start,
    pause,
    resume,
    stop,
    retry,
  };
}
