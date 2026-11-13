### Fixed

- A model or service on this computer (localhost, 127.0.0.1 and every other loopback address) is always reached directly: a proxy in the environment of the terminal that started Textus, or the app's own proxy setting, can no longer hijack the request. With the proxy set to None, Textus no longer picks up a proxy from that environment (`HTTPS_PROXY`) either: set one in Settings › Writing assist › Web and proxy if requests need it. The update check follows the same setting.
