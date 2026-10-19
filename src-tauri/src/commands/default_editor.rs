//! Settings › General › Default Markdown editor (#183): make Textus the app
//! that opens .md files, as far as each system lets an app do that itself.
//!
//! - Windows never lets an app make itself the default: the choice is a
//!   hashed `UserChoice` only the Settings app writes. So this registers
//!   Textus again for .md and .markdown - the per-user keys the installer
//!   writes (`src-tauri/installer/hooks.nsh`, change both) - and opens
//!   Default apps at Textus, where the user picks it.
//! - macOS: LaunchServices' default handler for the types .md and .markdown
//!   resolve to.
//! - Linux: `xdg-mime default` with the desktop entry the package installed.
//!   An AppImage has none of its own, so there it is unsupported.
//!
//! Neither command takes an argument: everything they write is fixed here.

use serde::Serialize;
use tauri::AppHandle;

/// What Settings shows for the row. `DefaultEditorStatus` in
/// src/platform/ipc.ts mirrors it - change both.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultEditorStatus {
    /// False where this installation can't be made the default (an AppImage).
    pub supported: bool,
    pub is_default: bool,
    /// The user makes the choice in the system's own settings, which
    /// `set_default_editor` opens (Windows); elsewhere it is made outright.
    pub choose_in_settings: bool,
}

#[tauri::command]
pub async fn default_editor_status(app: AppHandle) -> DefaultEditorStatus {
    platform::status(&app)
}

#[tauri::command]
pub async fn set_default_editor(app: AppHandle) -> Result<(), String> {
    platform::make_default(&app)
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/// The registry values that list Textus for Markdown files, all under
/// HKEY_CURRENT_USER. Built without touching the registry, so they can be
/// tested on every platform.
#[cfg(any(windows, test))]
mod registry {
    /// Textus's own ProgID. Not "Markdown", which other editors' installers
    /// (MarkText's, for one) also write and so took .md away from Textus.
    /// `bundle.fileAssociations` in tauri.windows.conf.json names it too.
    pub const PROG_ID: &str = "Textus.Markdown";
    pub const EXTENSIONS: [&str; 2] = [".md", ".markdown"];
    /// The name Default apps knows Textus by, in RegisteredApplications.
    pub const REGISTERED_APP: &str = "Textus";
    const CAPABILITIES: &str = r"Software\Textus\Capabilities";

    #[derive(Debug, PartialEq)]
    pub enum Data {
        /// REG_SZ
        Text(String),
        /// REG_NONE with no bytes: an entry whose name is the whole point.
        Empty,
    }

    #[derive(Debug, PartialEq)]
    pub struct Value {
        pub key: String,
        /// "" is the key's default value.
        pub name: String,
        pub data: Data,
    }

    fn text(key: &str, name: &str, data: &str) -> Value {
        Value {
            key: key.into(),
            name: name.into(),
            data: Data::Text(data.into()),
        }
    }

    /// Every value, for Textus installed at `exe` - the same set as
    /// TEXTUS_REGISTER in hooks.nsh. The extensions' own default values are
    /// left alone: those are the installer's, and Windows goes by the user's
    /// choice in Default apps anyway.
    pub fn values(exe: &str) -> Vec<Value> {
        let exe_name = exe.rsplit('\\').next().unwrap_or(exe);
        let open = format!("\"{exe}\" \"%1\"");
        let prog_id = format!(r"Software\Classes\{PROG_ID}");
        let app = format!(r"Software\Classes\Applications\{exe_name}");
        let mut values = vec![
            text(&prog_id, "", "Markdown document"),
            text(&format!(r"{prog_id}\DefaultIcon"), "", &format!("{exe},0")),
            text(&format!(r"{prog_id}\shell\open\command"), "", &open),
            text(&app, "FriendlyAppName", "Textus"),
            text(&format!(r"{app}\shell\open\command"), "", &open),
            text(CAPABILITIES, "ApplicationName", "Textus"),
            text(CAPABILITIES, "ApplicationDescription", "Markdown editor"),
            text(
                r"Software\RegisteredApplications",
                REGISTERED_APP,
                CAPABILITIES,
            ),
        ];
        for ext in EXTENSIONS {
            // What keeps Textus under "Open with" whoever holds the default.
            values.push(Value {
                key: format!(r"Software\Classes\{ext}\OpenWithProgids"),
                name: PROG_ID.into(),
                data: Data::Empty,
            });
            values.push(text(&format!(r"{app}\SupportedTypes"), ext, ""));
            values.push(text(
                &format!(r"{CAPABILITIES}\FileAssociations"),
                ext,
                PROG_ID,
            ));
        }
        values
    }

    /// Default apps, opened at Textus's entry (Windows 11; older versions
    /// open the Default apps page).
    pub fn settings_uri() -> String {
        format!("ms-settings:defaultapps?registeredAppUser={REGISTERED_APP}")
    }
}

#[cfg(windows)]
mod platform {
    use super::registry::{self, Data};
    use super::DefaultEditorStatus;
    use tauri::AppHandle;

    fn exe() -> Result<String, String> {
        std::env::current_exe()
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(|e| e.to_string())
    }

    /// The program Explorer opens a .md file with, the user's choice
    /// included.
    fn md_handler() -> Option<String> {
        use windows::core::{w, PCWSTR, PWSTR};
        use windows::Win32::UI::Shell::{AssocQueryStringW, ASSOCF_NONE, ASSOCSTR_EXECUTABLE};
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let found = unsafe {
            AssocQueryStringW(
                ASSOCF_NONE,
                ASSOCSTR_EXECUTABLE,
                w!(".md"),
                PCWSTR::null(),
                Some(PWSTR(buf.as_mut_ptr())),
                &mut len,
            )
        };
        found.is_ok().then(|| {
            let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            String::from_utf16_lossy(&buf[..end])
        })
    }

    pub fn status(_app: &AppHandle) -> DefaultEditorStatus {
        let is_default = match (md_handler(), exe()) {
            (Some(handler), Ok(exe)) => handler.eq_ignore_ascii_case(&exe),
            _ => false,
        };
        DefaultEditorStatus {
            supported: true,
            is_default,
            choose_in_settings: true,
        }
    }

    pub fn make_default(app: &AppHandle) -> Result<(), String> {
        use tauri_plugin_opener::OpenerExt;
        use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        use windows_registry::{Type, CURRENT_USER};

        for value in registry::values(&exe()?) {
            let key = CURRENT_USER.create(&value.key).map_err(|e| e.to_string())?;
            match &value.data {
                Data::Text(text) => key.set_string(&value.name, text),
                Data::Empty => key.set_bytes(&value.name, Type::Other(0), &[]),
            }
            .map_err(|e| e.to_string())?;
        }
        // Explorer caches file types; this makes "Open with" read them again.
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
        app.opener()
            .open_url(registry::settings_uri(), None::<&str>)
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

/// Markdown's type as macOS and most editors declare it.
#[cfg(any(target_os = "macos", test))]
const MARKDOWN_UTI: &str = "net.daringfireball.markdown";

/// The types to take over: what .md and .markdown resolve to on this Mac
/// (`resolved`, a `dyn.` type when nothing installed declares Markdown),
/// then Markdown's own type, each once. The first is the one checked for
/// the status.
#[cfg(any(target_os = "macos", test))]
fn content_types(resolved: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut types: Vec<String> = Vec::new();
    for uti in resolved.into_iter().chain([MARKDOWN_UTI.to_string()]) {
        if !types.iter().any(|t| t.eq_ignore_ascii_case(&uti)) {
            types.push(uti);
        }
    }
    types
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{content_types, DefaultEditorStatus};
    use objc2_core_foundation::{CFRetained, CFString};
    use std::ptr::NonNull;
    use tauri::AppHandle;

    /// kLSRolesAll: viewer and editor alike.
    const ROLES_ALL: u32 = 0xFFFF_FFFF;
    /// The value of kUTTagClassFilenameExtension.
    const FILENAME_EXTENSION: &str = "public.filename-extension";

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn UTTypeCreatePreferredIdentifierForTag(
            tag_class: &CFString,
            tag: &CFString,
            conforming_to: *const CFString,
        ) -> *mut CFString;
        fn LSCopyDefaultRoleHandlerForContentType(
            content_type: &CFString,
            role: u32,
        ) -> *mut CFString;
        fn LSSetDefaultRoleHandlerForContentType(
            content_type: &CFString,
            role: u32,
            handler: &CFString,
        ) -> i32;
    }

    /// A CFString returned under the Create rule, as a String.
    fn owned(ptr: *mut CFString) -> Option<String> {
        NonNull::new(ptr).map(|p| unsafe { CFRetained::from_raw(p) }.to_string())
    }

    fn markdown_types() -> Vec<String> {
        let class = CFString::from_str(FILENAME_EXTENSION);
        let resolved = ["md", "markdown"].into_iter().filter_map(|ext| {
            let tag = CFString::from_str(ext);
            owned(unsafe { UTTypeCreatePreferredIdentifierForTag(&class, &tag, std::ptr::null()) })
        });
        content_types(resolved)
    }

    pub fn status(app: &AppHandle) -> DefaultEditorStatus {
        let bundle_id = &app.config().identifier;
        let is_default = markdown_types().first().is_some_and(|uti| {
            let uti = CFString::from_str(uti);
            owned(unsafe { LSCopyDefaultRoleHandlerForContentType(&uti, ROLES_ALL) })
                .is_some_and(|handler| handler.eq_ignore_ascii_case(bundle_id))
        });
        DefaultEditorStatus {
            supported: true,
            is_default,
            choose_in_settings: false,
        }
    }

    pub fn make_default(app: &AppHandle) -> Result<(), String> {
        let bundle_id = CFString::from_str(&app.config().identifier);
        for uti in markdown_types() {
            let content_type = CFString::from_str(&uti);
            let status = unsafe {
                LSSetDefaultRoleHandlerForContentType(&content_type, ROLES_ALL, &bundle_id)
            };
            if status != 0 {
                return Err(format!("LaunchServices refused {uti} (OSStatus {status})"));
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------

/// The desktop entry ids Textus is installed under: the .deb and .rpm name
/// it after the product, the AUR package and the tarball after the binary.
#[cfg(any(target_os = "linux", test))]
const DESKTOP_IDS: [&str; 2] = ["Textus.desktop", "textus.desktop"];

/// The MIME types the desktop entry claims (packaging/linux/textus.desktop).
#[cfg(any(target_os = "linux", test))]
const MIME_TYPES: [&str; 2] = ["text/markdown", "text/x-markdown"];

/// The first of DESKTOP_IDS found in one of the `applications` folders, in
/// the XDG search order.
#[cfg(any(target_os = "linux", test))]
fn installed_desktop_id(
    applications: &[std::path::PathBuf],
    exists: impl Fn(&std::path::Path) -> bool,
) -> Option<&'static str> {
    applications
        .iter()
        .find_map(|dir| DESKTOP_IDS.into_iter().find(|id| exists(&dir.join(id))))
}

/// `xdg-mime`'s arguments to make `desktop_id` the default for Markdown.
#[cfg(any(target_os = "linux", test))]
fn xdg_mime_default_args(desktop_id: &str) -> Vec<&str> {
    let mut args = vec!["default", desktop_id];
    args.extend(MIME_TYPES);
    args
}

#[cfg(target_os = "linux")]
mod platform {
    use super::{installed_desktop_id, xdg_mime_default_args, DefaultEditorStatus, MIME_TYPES};
    use std::path::PathBuf;
    use std::process::Command;
    use tauri::AppHandle;

    /// `applications` under $XDG_DATA_HOME, then each of $XDG_DATA_DIRS.
    fn applications_dirs() -> Vec<PathBuf> {
        let env = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
        let home = env("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| env("HOME").map(|h| PathBuf::from(h).join(".local/share")));
        let dirs = env("XDG_DATA_DIRS").unwrap_or_else(|| "/usr/local/share:/usr/share".into());
        home.into_iter()
            .chain(dirs.split(':').map(PathBuf::from))
            .map(|dir| dir.join("applications"))
            .collect()
    }

    /// None in an AppImage: a packaged copy's desktop entry would open that
    /// copy, not this one.
    fn desktop_id() -> Option<&'static str> {
        if std::env::var_os("APPIMAGE").is_some() {
            return None;
        }
        installed_desktop_id(&applications_dirs(), |path| path.is_file())
    }

    pub fn status(_app: &AppHandle) -> DefaultEditorStatus {
        let Some(id) = desktop_id() else {
            return DefaultEditorStatus {
                supported: false,
                is_default: false,
                choose_in_settings: false,
            };
        };
        let is_default = Command::new("xdg-mime")
            .args(["query", "default", MIME_TYPES[0]])
            .output()
            .is_ok_and(|out| String::from_utf8_lossy(&out.stdout).trim() == id);
        DefaultEditorStatus {
            supported: true,
            is_default,
            choose_in_settings: false,
        }
    }

    pub fn make_default(_app: &AppHandle) -> Result<(), String> {
        let id = desktop_id().ok_or("no desktop entry for Textus is installed")?;
        let out = Command::new("xdg-mime")
            .args(xdg_mime_default_args(id))
            .output()
            .map_err(|e| format!("xdg-mime: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
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
        let installed = |paths: &'static [&'static str]| {
            move |p: &Path| paths.iter().any(|q| p == Path::new(q))
        };
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
}
