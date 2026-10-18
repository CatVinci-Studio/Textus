import type { MediaCapability, MediaProviderConfig } from "../platform/ipc";

type ProviderId = MediaProviderConfig["provider"];
interface CapabilityPreset {
  model: string;
  voice?: string;
  endpoint?: string;
  language?: string;
}
export interface MediaProviderPreset {
  id: ProviderId;
  label: string;
  endpoint: string;
  capabilities: Partial<Record<MediaCapability, CapabilityPreset>>;
}

/** This is the capability matrix implemented by the native media adapters.
 * A preset is not a claim that a provider implements every OpenAI route. */
export const MEDIA_PROVIDER_PRESETS: readonly MediaProviderPreset[] = [
  {
    id: "system",
    label: "System · on device",
    endpoint: "",
    capabilities: { stt: { model: "system" } },
  },
  {
    id: "openai",
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    capabilities: {
      stt: { model: "gpt-4o-mini-transcribe" },
      tts: { model: "gpt-4o-mini-tts", voice: "alloy" },
      image: { model: "gpt-image-1" },
    },
  },
  {
    id: "minimax",
    label: "MiniMax",
    endpoint: "https://api.minimax.cn/v1",
    capabilities: {
      stt: { model: "asr-1.0" },
      tts: { model: "speech-2.8-hd", voice: "English_expressive_narrator" },
      image: { model: "image-01" },
    },
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    endpoint: "https://api.elevenlabs.io/v1",
    capabilities: {
      stt: { model: "scribe_v2" },
      tts: { model: "eleven_multilingual_v2", voice: "21m00Tcm4TlvDq8ikWAM" },
    },
  },
  {
    id: "deepgram",
    label: "Deepgram",
    endpoint: "https://api.deepgram.com/v1",
    capabilities: {
      stt: { model: "nova-3" },
      tts: { model: "aura-2-thalia-en", voice: "aura-2-thalia-en" },
    },
  },
  {
    id: "gemini",
    label: "Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    capabilities: {
      tts: { model: "gemini-3.8-flash-tts", voice: "Kore" },
      image: { model: "gemini-2.5-flash-image" },
    },
  },
  {
    id: "dashscope",
    label: "DashScope",
    endpoint: "https://dashscope.aliyuncs.com/api/v1",
    capabilities: {
      stt: { model: "qwen3-asr-flash" },
      tts: { model: "qwen3-tts-flash", voice: "Cherry" },
      image: { model: "qwen-image-2.0-pro" },
    },
  },
  {
    id: "azure-speech",
    label: "Azure Speech",
    endpoint: "",
    capabilities: {
      stt: {
        model: "default",
        endpoint: "https://eastus.stt.speech.microsoft.com",
        language: "en-US",
      },
      tts: {
        model: "default",
        endpoint: "https://eastus.tts.speech.microsoft.com",
        voice: "en-US-JennyNeural",
        language: "en-US",
      },
    },
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    endpoint: "https://api.siliconflow.cn/v1",
    capabilities: {
      stt: { model: "FunAudioLLM/SenseVoiceSmall" },
      tts: {
        model: "FunAudioLLM/CosyVoice2-0.5B",
        voice: "FunAudioLLM/CosyVoice2-0.5B:alex",
      },
      image: { model: "Qwen/Qwen-Image" },
    },
  },
  {
    id: "groq",
    label: "Groq",
    endpoint: "https://api.groq.com/openai/v1",
    capabilities: {
      stt: { model: "whisper-large-v3-turbo" },
      tts: { model: "canopylabs/orpheus-v1-english", voice: "troy" },
    },
  },
  {
    id: "together",
    label: "Together",
    endpoint: "https://api.together.ai/v1",
    capabilities: {
      tts: { model: "hexgrad/Kokoro-82M", voice: "af_heart" },
      image: { model: "black-forest-labs/FLUX.1.1-pro" },
    },
  },
  {
    id: "volcengine",
    label: "Volcengine",
    endpoint: "https://ark.cn-beijing.volces.com/api/v3",
    capabilities: { image: { model: "doubao-seedream-5-0-lite-260128" } },
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    endpoint: "",
    capabilities: {
      stt: { model: "whisper-1" },
      tts: { model: "tts-1", voice: "alloy" },
      image: { model: "gpt-image-1" },
    },
  },
];
export function mediaPresets(capability: MediaCapability) {
  return MEDIA_PROVIDER_PRESETS.filter(
    (preset) => preset.capabilities[capability],
  );
}
export function mediaProviderDefaults(
  provider: ProviderId,
  capability: MediaCapability,
): MediaProviderConfig {
  const preset = MEDIA_PROVIDER_PRESETS.find((p) => p.id === provider);
  const defaults = preset?.capabilities[capability];
  if (!preset || !defaults) throw new Error("Unsupported media capability");
  return {
    provider,
    endpoint: defaults.endpoint ?? preset.endpoint,
    model: defaults.model,
    voice: defaults.voice ?? null,
    credentialSource: "separate",
    language: defaults.language ?? null,
    playbackRate: 1,
  };
}
