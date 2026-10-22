### Fixed

- Proposals from an OpenAI-compatible service that numbers its tool calls the same way in every reply (local servers such as Ollama and LM Studio do), or that sends no id at all, no longer vanish: a second request's proposal took the first one's place and both went, and a call with no id was dropped.
