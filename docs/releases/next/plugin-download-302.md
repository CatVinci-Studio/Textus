### Fixed

- Plugin downloads failed with "answered 302 Found" when the install
  counter redirected from `textus.md` to `textus.catvinci.com` — the
  redirect policy compared the whole URL as a string and stopped at the
  host change. It now follows a redirect across mirror hosts that serve
  the same path.
