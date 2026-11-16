### Fixed

- A SOCKS5 proxy setting now really connects, and resolves names at the proxy (`socks5h`): on an intranet, this computer's own DNS cannot look up an address elsewhere, and without this the request failed before it left the computer.
