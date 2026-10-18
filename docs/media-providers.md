# Media provider contracts

Protocol documentation checked on 2026-10-18. Configure provider, endpoint, model, voice, language and playback rate only in Settings → Textus AI → Media. API keys remain in the native private key store. Each capability has its own configuration and credential. An explicitly selected MiniMax text credential can be reused only between trusted MiniMax HTTPS hosts.

## Supported capabilities

A dash means the combination is rejected by the backend; the provider is not silently treated as OpenAI compatible. Remote dictation records a bounded clip and transcribes it after stopping. The macOS **system** option uses local on-device dictation with live partial text and makes no remote media request. Remote WebSocket/live transcription is not implemented.

| Provider ID         | STT   | TTS | Image | API base and suggested models / voices                                                                                                                                                                    |
| ------------------- | ----- | --- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system`            | Local | —   | —     | No endpoint or key; macOS speech permissions and on-device language availability apply                                                                                                                    |
| `openai`            | Yes   | Yes | Yes   | `https://api.openai.com/v1`; `gpt-4o-mini-transcribe`, `gpt-4o-mini-tts` / `alloy`, `gpt-image-1`                                                                                                         |
| `openai-compatible` | Yes   | Yes | Yes   | User's actual OpenAI-compatible base and supported models; separate routes `/audio/transcriptions`, `/audio/speech`, `/images/generations`                                                                |
| `minimax`           | Yes   | Yes | Yes   | `https://api.minimax.cn/v1`; `asr-1.0`, `speech-2.8-hd` / `English_expressive_narrator`, `image-01` or `image-01-live`                                                                                    |
| `elevenlabs`        | Yes   | Yes | —     | `https://api.elevenlabs.io/v1`; `scribe_v2`, `eleven_multilingual_v2` / a valid voice ID, e.g. `21m00Tcm4TlvDq8ikWAM`                                                                                     |
| `deepgram`          | Yes   | Yes | —     | `https://api.deepgram.com/v1`; `nova-3`, `aura-2-thalia-en` (the TTS model ID selects the voice)                                                                                                          |
| `gemini`            | —     | Yes | Yes   | `https://generativelanguage.googleapis.com/v1beta`; `gemini-3.8-flash-tts` / `Kore`, `gemini-2.5-flash-image`; current `gemini-nano-banana-2.1` also uses the documented generateContent contract         |
| `dashscope`         | Yes   | Yes | Yes   | `https://dashscope.aliyuncs.com/api/v1` or the workspace/region-specific `/api/v1` base; `qwen3-asr-flash`, `qwen3-tts-flash` / `Cherry`, `qwen-image-2.0-pro`                                            |
| `azure-speech`      | Yes   | Yes | —     | STT `https://eastus.stt.speech.microsoft.com`; TTS `https://eastus.tts.speech.microsoft.com`; replace region to match resource key, set model `default`; TTS voice `en-US-JennyNeural` and locale `en-US` |
| `siliconflow`       | Yes   | Yes | Yes   | `https://api.siliconflow.cn/v1`; `FunAudioLLM/SenseVoiceSmall`, `FunAudioLLM/CosyVoice2-0.5B` / `FunAudioLLM/CosyVoice2-0.5B:alex`, `Qwen/Qwen-Image`                                                     |
| `groq`              | Yes   | Yes | —     | `https://api.groq.com/openai/v1`; `whisper-large-v3-turbo`, `canopylabs/orpheus-v1-english` / `troy`                                                                                                      |
| `together`          | —     | Yes | Yes   | `https://api.together.ai/v1`; `hexgrad/Kokoro-82M` / `af_heart`, `black-forest-labs/FLUX.1.1-pro`                                                                                                         |
| `volcengine`        | —     | —   | Yes   | `https://ark.cn-beijing.volces.com/api/v3`; `doubao-seedream-5-0-lite-260128`                                                                                                                             |

Models, regional availability, account access and voice IDs can change. These are editable defaults, not an assertion that every account has access. Together STT and Volcengine speech APIs are not wired through the generic compatibility adapter.

## Native wire formats and bounds

- ElevenLabs uses `xi-api-key`, multipart `model_id`/`file` for STT and `/text-to-speech/{voice_id}` for MP3 TTS.
- Deepgram uses `Authorization: Token`, raw audio `/listen?model=...`, nested `results.channels[0].alternatives[0].transcript`, and `/speak?model=...&encoding=mp3`.
- Gemini uses `x-goog-api-key` and `/models/{model}:generateContent`; image/audio output is decoded from `candidates[].content.parts[].inlineData`. Legacy TTS PCM16 is wrapped in a WAV header using the reported sample rate. Gemini 3.8 uses `voiceConfig.voice`; older TTS uses `prebuiltVoiceConfig.voiceName`.
- DashScope uses bearer auth and the native synchronous multimodal-generation route for ASR, Qwen TTS and Qwen image. ASR embeds an audio data URI and requires at most 10 MiB after base64 encoding. Qwen TTS accepts at most 600 characters per segment. The synchronous image adapter targets Qwen 2.0; models requiring a different asynchronous route need their own adapter.
- Azure Speech uses `Ocp-Apim-Subscription-Key`, raw PCM16 mono 16 kHz WAV for short STT (maximum 60 seconds), and escaped SSML for MP3 TTS. Its REST APIs do not select a model using the generic model field.
- MiniMax uses its native ASR/image routes and `/t2a_v2` for TTS; TTS requests non-streaming hex audio and validates the business status before decoding.
- SiliconFlow image uses `image_size` and reads `images[].url`. Together image uses `width`/`height` (or `aspect_ratio` for Schnell/Kontext). Volcengine requests a single generation with `sequential_image_generation: disabled`; square requests map to 2048×2048 to meet Seedream 5.0 Lite’s minimum pixel count, and non-square requests are rejected under the local 2048-per-side decoder bound. Groq TTS requests WAV.
- All remote recordings are limited to 25 MiB; speech input is 1–3000 characters (Qwen's smaller limit also applies). Synthesized audio is normalized to actual WAV or MP3 bytes, at most 15 MiB. Images must decode as PNG/JPEG/WebP, at most 20 MiB and 2048×2048 pixels.
- Generated download URLs use the shared public-address DNS-pinned HTTPS downloader, no redirects and no system proxy. DashScope OSS URLs advertising HTTP are upgraded to HTTPS; arbitrary HTTP downloads remain rejected. Response bodies are bounded while streaming. HTTP errors do not echo provider response bodies or credentials.
- Language accepts a bounded BCP-47-style tag or automatic detection. OpenAI-style multipart ASR, ElevenLabs and DashScope receive its primary language subtag; Azure and Deepgram retain locale information. Playback rate is validated between 0.5 and 2 and applied locally, avoiding double speed changes in provider synthesis.

## Primary protocol references

- [OpenAI audio](https://platform.openai.com/docs/api-reference/audio) and [images](https://platform.openai.com/docs/api-reference/images).
- [MiniMax STT](https://platform.minimax.io/docs/api-reference/speech-to-text) and [synchronous TTS](https://platform.minimax.io/docs/api-reference/speech-t2a-http).
- [ElevenLabs STT](https://elevenlabs.io/docs/api-reference/speech-to-text/convert) and [TTS](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).
- [Deepgram recorded STT](https://developers.deepgram.com/docs/pre-recorded-audio) and [TTS](https://developers.deepgram.com/docs/text-to-speech).
- [Gemini generateContent TTS](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation) and [image generation](https://ai.google.dev/gemini-api/docs/generate-content/image-generation).
- [DashScope ASR](https://help.aliyun.com/en/model-studio/qwen-asr-api-reference), [Qwen TTS](https://www.alibabacloud.com/help/en/model-studio/qwen-tts-api) and [Qwen image](https://help.aliyun.com/en/model-studio/qwen-image-api).
- [Azure short STT](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short) and [TTS](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech).
- [SiliconFlow transcription](https://siliconflow.readme.io/reference/createaudiotranscriptions), [TTS](https://docs.siliconflow.cn/docs/userguide/capabilities/text-to-speech), [image protocol](https://api-docs.siliconflow.cn/docs/api/images-generations-post) and [September 2026 image API changes](https://docs.siliconflow.cn/docs/release-notes/overview).
- [Groq speech recognition](https://console.groq.com/docs/speech-to-text) and [TTS](https://console.groq.com/docs/text-to-speech).
- [Together TTS](https://docs.together.ai/docs/inference/text-to-speech/overview) and [images](https://docs.together.ai/docs/inference/images/overview).
- [Volcengine image generation](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh&redirect=1).

## Verification

Deterministic local HTTP fixtures exercise native request contracts, authentication, JSON decoding, audio normalization and image decoding without credentials or paid calls. Normal tests never invoke ignored live tests. Passing fixtures establish protocol behavior; they do not establish account access or current live service availability.

Existing opt-in MiniMax smoke commands (run only with explicit authorization):

```sh
TEXTUS_MINIMAX_LIVE=1 \
TEXTUS_MINIMAX_CONFIG_DIR='/path/to/Textus/config-directory' \
TEXTUS_MEDIA_TEST_OUTPUT='/tmp/textus-media-output' \
CARGO_TARGET_DIR='/Users/zhuohang/Documents/Levis/src-tauri/target' \
/Users/zhuohang/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml \
  media::live_tests::minimax_live_image --lib -- --ignored --exact
```

For synthetic speech recognition, set `TEXTUS_STT_TEST_WAV` to a locally generated PCM WAV fixture containing the word “speech” and select `media::live_tests::minimax_live_speech_input` instead. The existing native harness reads the reusable MiniMax text key internally and never prints it. There is no automatic paid test of the other providers.
