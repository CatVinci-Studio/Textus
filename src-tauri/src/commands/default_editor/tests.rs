
use super::*;
use std::path::{Path, PathBuf};

#[test]
fn windows_lists_textus_under_open_with_without_taking_the_default() {
    let exe = r"C:\Users\me\AppData\Local\Textus\Textus.exe";
    let values = registry::values(exe);
    let find = |key: &str, name: &str| {
        values
            .iter()
            .find(|v| v.key == key && v.name == name)
            .map(|v| &v.data)
    };
    for ext in [".md", ".markdown"] {
        assert_eq!(
            find(
                &format!(r"Software\Classes\{ext}\OpenWithProgids"),
                "Textus.Markdown"
            ),
            Some(&registry::Data::Empty)
        );
        assert_eq!(
            find(
                r"Software\Classes\Applications\Textus.exe\SupportedTypes",
                ext
            ),
            Some(&registry::Data::Text(String::new()))
        );
        assert_eq!(
            find(r"Software\Textus\Capabilities\FileAssociations", ext),
            Some(&registry::Data::Text("Textus.Markdown".into()))
        );
        // The extension's default value is not ours to set.
        assert!(find(&format!(r"Software\Classes\{ext}"), "").is_none());
    }
    // The path is quoted: an install folder may have a space in it.
    let open = registry::Data::Text(format!("\"{exe}\" \"%1\""));
    assert_eq!(
        find(r"Software\Classes\Textus.Markdown\shell\open\command", ""),
        Some(&open)
    );
    assert_eq!(
        find(
            r"Software\Classes\Applications\Textus.exe\shell\open\command",
            ""
        ),
        Some(&open)
    );
    assert_eq!(
        find(r"Software\RegisteredApplications", "Textus"),
        Some(&registry::Data::Text(
            r"Software\Textus\Capabilities".into()
        ))
    );
    // Everything stays under HKEY_CURRENT_USER's Software.
    assert!(values.iter().all(|v| v.key.starts_with(r"Software\")));
}

#[test]
fn windows_opens_default_apps_at_the_registered_name() {
    assert_eq!(
        registry::settings_uri(),
        "ms-settings:defaultapps?registeredAppUser=Textus"
    );
}

#[test]
fn macos_claims_each_resolved_type_once_and_markdown_last() {
    assert_eq!(
        content_types([
            "net.daringfireball.markdown".to_string(),
            "dyn.ah62d4rv4ge81e5pe".to_string()
        ]),
        ["net.daringfireball.markdown", "dyn.ah62d4rv4ge81e5pe"]
    );
    assert_eq!(content_types([]), ["net.daringfireball.markdown"]);
}

#[test]
fn linux_finds_the_packaged_desktop_entry_in_search_order() {
    let dirs = [
        PathBuf::from("/home/me/.local/share/applications"),
        PathBuf::from("/usr/share/applications"),
    ];
    let installed =
        |paths: &'static [&'static str]| move |p: &Path| paths.iter().any(|q| p == Path::new(q));
    assert_eq!(
        installed_desktop_id(
            &dirs,
            installed(&["/usr/share/applications/Textus.desktop"])
        ),
        Some("Textus.desktop")
    );
    assert_eq!(
        installed_desktop_id(
            &dirs,
            installed(&["/usr/share/applications/textus.desktop"])
        ),
        Some("textus.desktop")
    );
    // An AppImage installs nothing.
    assert_eq!(installed_desktop_id(&dirs, installed(&[])), None);
}

#[test]
fn linux_sets_both_markdown_mime_types() {
    assert_eq!(
        xdg_mime_default_args("Textus.desktop"),
        [
            "default",
            "Textus.desktop",
            "text/markdown",
            "text/x-markdown"
        ]
    );
}
