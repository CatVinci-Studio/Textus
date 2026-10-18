import { useCallback, useEffect, useRef, useState } from "react";
import { dictation, media } from "../platform/ipc";
import { useRecording } from "./useRecording";
import type { DictationTargetSession } from "./dictation-target";
import { errorText } from "../utils/error-text";

export function useDictationCapture(
  active: boolean,
  language: string,
  capture: () => DictationTargetSession | null,
) {
  const [provider, setProvider] = useState("system");
  const [locale, setLocale] = useState<string | null>(language);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = useRef(crypto.randomUUID());
  const session = useRef<DictationTargetSession | null>(null);
  const generation = useRef(0);
  const token = useRef<number | null>(null);
  /** The first start shows the macOS permission prompt, which takes focus;
   *  that blur must not cancel the capture being authorized. */
  const starting = useRef(false);
  const recording = useRecording(active, locale, provider, true);
  const recordingCancel = useRef(recording.cancel);
  recordingCancel.current = recording.cancel;
  const cancel = useCallback(() => {
    generation.current++;
    session.current?.finish?.();
    session.current = null;
    setListening(false);
    if (token.current !== null)
      void dictation.stop(token.current).catch(() => {});
    token.current = null;
    recordingCancel.current();
  }, []);
  useEffect(() => {
    let live = true;
    const load = () => {
      cancel();
      void media
        .providers()
        .then((configs) => {
          if (!live) return;
          const selected = configs.stt?.provider ?? "system";
          setProvider(selected);
          const configured = configs.stt?.language;
          setLocale(
            configured && configured !== "auto"
              ? configured
              : selected === "system"
                ? language
                : null,
          );
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("textus-media-settings-change", load);
    return () => {
      live = false;
      window.removeEventListener("textus-media-settings-change", load);
    };
  }, [language, cancel]);
  useEffect(() => {
    if (!active) cancel();
    return cancel;
  }, [active, cancel]);
  useEffect(() => {
    const competing = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== owner.current) cancel();
    };
    window.addEventListener("textus-dictation-start", competing);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    const blur = () => {
      if (!starting.current) cancel();
    };
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("textus-dictation-start", competing);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", escape);
    };
  }, [cancel]);
  const apply = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      if (!session.current?.apply(text)) cancel();
    },
    [cancel],
  );
  const previousRecordingState = useRef(recording.state);
  useEffect(() => {
    const previous = previousRecordingState.current;
    previousRecordingState.current = recording.state;
    if (previous !== "idle" && recording.state === "idle") cancel();
    if (recording.state === "review" && session.current) {
      apply(recording.text);
      cancel();
    }
    if (recording.state === "error") {
      setError(recording.error);
      cancel();
    }
  }, [recording.state, recording.text, recording.error, apply, cancel]);
  async function start() {
    if (!active) return;
    cancel();
    window.dispatchEvent(
      new CustomEvent("textus-dictation-start", { detail: owner.current }),
    );
    session.current = capture();
    if (!session.current) return;
    setError(null);
    setListening(true);
    const run = generation.current;
    starting.current = true;
    if (provider !== "system") {
      try {
        await recording.start();
      } finally {
        starting.current = false;
      }
      return;
    }
    try {
      const nativeLocale = locale || language;
      const id = await dictation.start(
        nativeLocale === "zh" ? "zh-CN" : nativeLocale,
        (event) => {
          if (run !== generation.current) return;
          if (event.error) {
            setError(event.text);
            cancel();
            return;
          }
          apply(event.text);
          if (event.done) cancel();
        },
      );
      if (run !== generation.current) void dictation.stop(id).catch(() => {});
      else token.current = id;
    } catch (err) {
      if (run === generation.current) {
        setError(errorText(err));
        cancel();
      }
    } finally {
      starting.current = false;
    }
  }
  return {
    listening,
    error,
    cancel,
    toggle: () => {
      if (listening) {
        if (provider !== "system") recording.stopAndTranscribe();
        else cancel();
      } else void start();
    },
  };
}
