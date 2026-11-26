### Fixed

- Plugin downloads failed with "answered 302 Found": the install counter sent them on to the site's old address, `textus.catvinci.com`, which the download didn't follow. The counter now sends them to `textus.md`, and the app no longer reaches for the old address at all.
- Download and catalog errors now say where the answer came from, where a stopped redirect points, and which proxy was in effect, so an intercepting proxy (an intranet gateway that redirects a host it doesn't allow) is visible in the message instead of a bare status code.
