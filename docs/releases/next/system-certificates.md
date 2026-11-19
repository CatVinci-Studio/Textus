### Fixed

- External agents and MCP servers that run on Node (Codex, Claude, Gemini and others) now trust the certificates installed on this computer too, as the app's own requests do: behind a company proxy that re-signs TLS, they were refused. This needs Node 22.15 or later.
