### Fixed

- Plugin downloads failed with "answered 302 Found" when the install
  counter redirected from `textus.md` to `textus.catvinci.com` — the
  redirect policy compared the whole URL as a string and stopped at the
  host change. It now follows a redirect across mirror hosts that serve
  the same path.
- Download and catalog errors now say where the answer came from, where a
  stopped redirect points, and which proxy was in effect, so an
  intercepting proxy (an intranet gateway that 302s a host it doesn't
  allow) is visible in the message instead of a bare status code.
