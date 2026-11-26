### Fixed

- **Remote pictures refused by image hosts that guard against hotlinking**: a picture loaded with our own origin as its referrer, and hosts that check it (several Chinese image CDNs do) answered 403 to an origin they don't know - the same picture opened in a browser, with no referrer, loaded fine. Pictures now load with an empty referrer, like other editors send.
