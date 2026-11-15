//! The version of a catalog plugin this Textus can run: the newest, or,
//! when that needs a newer Textus, the newest earlier one that doesn't.

use super::CatalogEntry;
use semver::Version;
use serde::{Deserialize, Serialize};

/// An earlier version the catalog keeps (textus-plugins scripts/history.mjs).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct EarlierVersion {
    pub version: String,
    /// Its `engines.textus`.
    pub textus: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    pub url: String,
    pub sha256: String,
    #[serde(default)]
    pub size: u64,
}

/// Whether Textus `version` is in `range`, as engineSatisfied (versions.ts)
/// reads it: `^1.3.0`, `>=1.3.0`, `1.3.x`, exact or `*`. A pre-release of
/// Textus counts as its release unless the range names a pre-release.
pub(super) fn runs_on(range: &str, version: &str) -> bool {
    let range = range.trim();
    if range == "*" {
        return true;
    }
    let base = range
        .trim_start_matches(">=")
        .trim_start_matches('^')
        .trim();
    let release = if base.contains('-') {
        version
    } else {
        version.split('-').next().unwrap_or(version)
    };
    let (Ok(have), base_version) = (Version::parse(release), Version::parse(base)) else {
        return false;
    };
    if let Some(minor) = range.strip_suffix(".x") {
        return format!("{}.{}", have.major, have.minor) == minor;
    }
    let Ok(base) = base_version else { return false };
    if range.starts_with(">=") {
        have >= base
    } else if range.starts_with('^') {
        have >= base && have.major == base.major
    } else {
        have == base
    }
}

/// `entry` as the version that runs on Textus `app`: the newest, or the
/// newest earlier one that does. When none does, the newest stays, and
/// Settings says which Textus it needs.
pub(super) fn fitted(mut entry: CatalogEntry, app: &str) -> CatalogEntry {
    let needs = |manifest: &serde_json::Value| {
        manifest["engines"]["textus"]
            .as_str()
            .unwrap_or("*")
            .to_string()
    };
    if runs_on(&needs(&entry.manifest), app) {
        return entry;
    }
    let Some(earlier) = entry
        .versions
        .iter()
        .find(|v| runs_on(&v.textus, app))
        .cloned()
    else {
        return entry;
    };
    entry.manifest["version"] = earlier.version.clone().into();
    entry.manifest["engines"]["textus"] = earlier.textus.clone().into();
    entry.manifest["permissions"] = earlier.permissions.clone().into();
    entry.version = earlier.version;
    entry.url = earlier.url;
    entry.sha256 = earlier.sha256;
    entry.size = earlier.size;
    entry
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ranges_read_as_the_window_reads_them() {
        assert!(runs_on(">=1.4.2", "1.4.3-rc.1"));
        assert!(!runs_on(">=1.4.3", "1.4.2"));
        assert!(runs_on("^1.3.0", "1.4.2") && !runs_on("^1.3.0", "2.0.0"));
        assert!(runs_on("1.4.x", "1.4.9") && !runs_on("1.4.x", "1.5.0"));
        assert!(!runs_on(">=1.4.3-rc.2", "1.4.3-rc.1"));
    }

    #[test]
    fn an_older_textus_gets_the_newest_version_it_runs() {
        let earlier = |version: &str, textus: &str| EarlierVersion {
            version: version.into(),
            textus: textus.into(),
            permissions: vec!["files.read".into()],
            url: format!("u-{version}"),
            sha256: format!("s-{version}"),
            size: 1,
        };
        let entry = CatalogEntry {
            id: "a.b".into(),
            version: "0.3.0".into(),
            manifest: json!({ "version": "0.3.0", "engines": { "textus": ">=1.4.3" } }),
            url: "u-0.3.0".into(),
            versions: vec![earlier("0.2.0", ">=1.4.2"), earlier("0.1.0", ">=1.3.0")],
            ..CatalogEntry::default()
        };
        let got = fitted(entry.clone(), "1.4.2");
        assert_eq!(
            (got.version.as_str(), got.url.as_str()),
            ("0.2.0", "u-0.2.0")
        );
        assert_eq!(got.manifest["engines"]["textus"], ">=1.4.2");
        assert_eq!(fitted(entry.clone(), "1.4.3").version, "0.3.0");
        // None runs: the newest stays, to say which Textus it needs.
        assert_eq!(fitted(entry, "1.2.0").version, "0.3.0");
    }
}
