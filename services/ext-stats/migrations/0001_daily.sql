-- Daily totals of downloads only: no identifier, no address, no row per
-- request.
CREATE TABLE daily (
  -- YYYY-MM-DD, UTC.
  day TEXT NOT NULL,
  -- plugin, theme or skill.
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  -- install, reinstall or update.
  event TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, kind, id, version, event)
);
