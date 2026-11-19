### Fixed

- A SOCKS5 proxy setting now really connects, and resolves names at the proxy (`socks5h`): on an intranet, this computer's own DNS cannot look up an address elsewhere, and without this the request failed before it left the computer.
- On Windows, "follow the system" now reads a `ProxyServer` setting in the per-protocol form (`http=...;https=...`) the way the browser does; that shape was silently dropped before, and requests then went direct, failing with a name error on an intranet. It also follows an automatic-configuration script (PAC) and WPAD discovery, again like the browser.
- A proxy address pasted with its scheme (`http://host:port`) is taken as it is; before, another scheme was prefixed onto it and the request went looking for a host literally named "http".
- A catalog or download failure now says which proxy was in effect (its credentials masked), so a wrong proxy address shows itself.
- Requests now trust the certificates installed on this computer (the system's certificate store), not only the bundled ones: a proxy that re-signs TLS with its own certificate - common on corporate networks - was refused with "invalid peer certificate: UnknownIssuer".
