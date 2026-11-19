### Fixed

- External agents and MCP servers that run on Node now trust the certificates installed on this computer too, as the app's own requests do: behind a company proxy that re-signs TLS, they were refused. This needs Node 24.6 or later.
