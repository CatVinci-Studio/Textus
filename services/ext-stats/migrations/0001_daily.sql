-- Daily totals only: no identifier, no address, no row per request.
CREATE TABLE daily (
  -- YYYY-MM-DD, UTC.
  day TEXT NOT NULL,
  -- plugin, theme or skill.
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  -- install, reinstall, update or uninstall.
  event TEXT NOT NULL,
  -- mac, windows, linux or ios.
  os TEXT NOT NULL,
  -- The app's minor version, e.g. 1.3.
  app TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, kind, id, version, event, os, app)
);
