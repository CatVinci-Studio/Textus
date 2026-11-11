//! Errors the user sees, by code: src/i18n/errors.json gives each its English
//! and the frontend's words for it. The text says the English, then the code
//! in brackets, which the frontend reads to say it in the user's language.

use std::collections::HashMap;
use std::sync::LazyLock;

#[derive(serde::Deserialize)]
struct Entry {
    en: String,
}

static TABLE: LazyLock<HashMap<String, Entry>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../src/i18n/errors.json")).expect("errors.json")
});

/// The error `code` stands for, as the user's error text.
pub(crate) fn error(code: &str) -> String {
    match TABLE.get(code) {
        Some(entry) => format!("{} [{code}]", entry.en),
        None => {
            debug_assert!(false, "no error {code} in errors.json");
            code.to_string()
        }
    }
}

/// Whether `err` is the error `code` stands for.
pub(crate) fn is(err: &str, code: &str) -> bool {
    err.ends_with(&format!("[{code}]"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn every_code_the_backend_gives_is_in_the_table() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut used = Vec::new();
        let mut stack = vec![root];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|e| e == "rs") {
                    let text = std::fs::read_to_string(&path).unwrap();
                    for part in text.split("errors::error(\"").skip(1) {
                        used.push(part.split('"').next().unwrap().to_string());
                    }
                }
            }
        }
        assert!(used.len() > 10, "{used:?}");
        for code in used {
            assert!(super::TABLE.contains_key(&code), "no {code} in errors.json");
        }
    }
}
