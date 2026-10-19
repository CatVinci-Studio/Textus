//! The Quick Note shortcut: one key combination registered with the OS
//! (tauri-plugin-global-shortcut), off until the user turns it on in
//! Settings › General › Quick Notes.
//!
//! Rust only - no npm package, no JS permission - and the plugin is added
//! to the app the first time the shortcut is turned on, not at startup: an
//! install that never uses it pays nothing for it. The OS delivers exactly
//! the one combination registered here and nothing else, which is what the
//! Settings row tells the user.

use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Settings fields (src/settings/SettingsContext.tsx): whether the shortcut
/// is on, and the accelerator ("Control+Alt+N"), or "" for the platform's
/// default below.
pub const ENABLED_SETTING: &str = "quickNoteShortcutEnabled";
pub const ACCELERATOR_SETTING: &str = "quickNoteShortcut";

/// Rust -> every window: the shortcut's state changed. Payload: Status.
/// Mirrors QUICK_NOTE_SHORTCUT_STATUS in src/platform/ipc.ts.
pub const STATUS_EVENT: &str = "quick-note-shortcut-status";

/// The default combination per platform. Mirrors defaultQuickNoteAccelerator
/// in src/utils/accelerator.ts.
///
/// Windows takes Win+Alt+N, not Ctrl+Alt+N: Windows reads Ctrl+Alt as AltGr,
/// which types ń, ł and the like on Polish and other layouts - a global
/// Ctrl+Alt+N would eat that letter in every app.
pub fn default_accelerator() -> &'static str {
    if cfg!(windows) {
        "Super+Alt+N"
    } else {
        "Control+Alt+N"
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Os {
    Mac,
    Windows,
    Linux,
}

impl Os {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            Os::Mac
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Linux
        }
    }
}

/// Why an accelerator can't be the Quick Note shortcut. The names are what
/// Settings shows a message for (QuickNoteShortcutStatus in
/// src/platform/ipc.ts).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Invalid {
    Unparsable,
    /// Fewer than two modifiers, and not a function key with one: a
    /// shortcut that fires in every app must not shadow ordinary typing or
    /// the apps' own Ctrl+letter commands.
    TooFewModifiers,
    /// The OS keeps it for itself (Spotlight, the task switcher, a lock or
    /// screenshot key...).
    Reserved,
    /// Windows: Ctrl+Alt+<key> is AltGr+<key> there.
    AltGr,
}

impl Invalid {
    fn name(self) -> &'static str {
        match self {
            Invalid::Unparsable => "unparsable",
            Invalid::TooFewModifiers => "tooFewModifiers",
            Invalid::Reserved => "reserved",
            Invalid::AltGr => "altGr",
        }
    }
}

const MODIFIERS: [Modifiers; 4] = [
    Modifiers::SHIFT,
    Modifiers::CONTROL,
    Modifiers::ALT,
    Modifiers::SUPER,
];

fn is_function_key(code: Code) -> bool {
    use Code::*;
    matches!(
        code,
        F1 | F2
            | F3
            | F4
            | F5
            | F6
            | F7
            | F8
            | F9
            | F10
            | F11
            | F12
            | F13
            | F14
            | F15
            | F16
            | F17
            | F18
            | F19
            | F20
            | F21
            | F22
            | F23
            | F24
    )
}

/// Combinations each OS keeps for itself, or that a desktop on it binds by
/// default. Not exhaustive - nothing could be - but the ones a user is
/// likely to press when choosing.
fn reserved(os: Os) -> &'static [&'static str] {
    match os {
        Os::Mac => &[
            "Control+Super+Space",
            "Super+Alt+Space",
            "Super+Shift+Tab",
            "Super+Shift+3",
            "Super+Shift+4",
            "Super+Shift+5",
            "Super+Shift+6",
            "Super+Alt+Escape",
            "Control+Super+Q",
            "Control+Super+F",
            "Super+Shift+Q",
            "Super+Alt+D",
            "Super+Alt+H",
            "Super+Alt+M",
            "Super+Alt+W",
            "Control+Super+D",
        ],
        Os::Windows => &[
            "Control+Alt+Delete",
            "Control+Shift+Escape",
            "Alt+Shift+Tab",
            "Super+Shift+S",
            "Super+Alt+R",
            "Super+Alt+G",
            "Super+Alt+B",
            "Super+Alt+K",
            "Super+Alt+PrintScreen",
            "Super+Control+D",
            "Super+Control+F4",
            "Super+Control+Left",
            "Super+Control+Right",
            "Super+Control+Enter",
            "Super+Control+O",
            "Super+Control+Shift+B",
            "Super+Shift+Left",
            "Super+Shift+Right",
            "Super+Shift+Up",
            "Super+Shift+Down",
            "Super+Shift+M",
            "Super+Shift+C",
            "Super+Shift+T",
            "Super+Alt+D",
        ],
        Os::Linux => &[
            "Control+Alt+Delete",
            "Control+Alt+Backspace",
            "Control+Alt+T",
            "Control+Alt+L",
            "Control+Alt+D",
            "Control+Alt+Tab",
            "Control+Alt+Left",
            "Control+Alt+Right",
            "Control+Alt+Up",
            "Control+Alt+Down",
            "Control+Alt+Escape",
            "Super+Shift+Left",
            "Super+Shift+Right",
            "Super+Shift+Up",
            "Super+Shift+Down",
            "Super+Shift+Q",
            "Super+Shift+Enter",
            "Super+Shift+PageUp",
            "Super+Shift+PageDown",
            "Alt+Shift+Tab",
            "Control+Shift+Escape",
        ],
    }
}

fn same(a: &Shortcut, b: &Shortcut) -> bool {
    a.mods == b.mods && a.key == b.key
}

/// `accelerator` as a Quick Note shortcut for `os`, or why it can't be one.
pub fn validate(accelerator: &str, os: Os) -> Result<Shortcut, Invalid> {
    let shortcut = Shortcut::from_str(accelerator).map_err(|_| Invalid::Unparsable)?;
    let modifiers = MODIFIERS
        .iter()
        .filter(|m| shortcut.mods.contains(**m))
        .count();
    let enough = modifiers >= 2 || (modifiers == 1 && is_function_key(shortcut.key));
    if !enough {
        return Err(Invalid::TooFewModifiers);
    }
    let is_reserved = reserved(os)
        .iter()
        .filter_map(|r| Shortcut::from_str(r).ok())
        .any(|r| same(&r, &shortcut))
        // Every OS: switching apps and closing windows.
        || [Code::Tab, Code::F4].contains(&shortcut.key)
            && shortcut.mods.contains(Modifiers::ALT)
            && !shortcut.mods.contains(Modifiers::SUPER)
        // Linux: Ctrl+Alt+F1..F12 switch virtual terminals.
        || os == Os::Linux
            && shortcut.mods == Modifiers::CONTROL | Modifiers::ALT
            && is_function_key(shortcut.key);
    if is_reserved {
        return Err(Invalid::Reserved);
    }
    // Ctrl+Alt (with or without Shift) and no Win key, on anything that
    // types a character.
    if os == Os::Windows
        && shortcut.mods.contains(Modifiers::CONTROL | Modifiers::ALT)
        && !shortcut.mods.contains(Modifiers::SUPER)
        && !is_function_key(shortcut.key)
    {
        return Err(Invalid::AltGr);
    }
    Ok(shortcut)
}

/// What the shortcut is doing now, for Settings. Mirrors
/// QuickNoteShortcutStatus in src/platform/ipc.ts.
#[derive(Clone, serde::Serialize, Debug, PartialEq)]
pub struct Status {
    /// "off", "on", "inUse" (another app holds it), "wayland" (the session
    /// gives apps no global shortcuts), "invalid".
    pub state: &'static str,
    pub accelerator: String,
    /// For "invalid": Invalid's name.
    pub reason: Option<&'static str>,
}

impl Status {
    fn new(state: &'static str, accelerator: &str) -> Self {
        Status {
            state,
            accelerator: accelerator.to_string(),
            reason: None,
        }
    }
}

/// The last Status `apply` arrived at.
pub struct ShortcutStatus(pub Mutex<Option<Status>>);

/// Whether the plugin has been added to the app: once, on first use.
static PLUGIN_LOADED: AtomicBool = AtomicBool::new(false);

fn accelerator_setting(app: &AppHandle) -> String {
    crate::settings::read_setting(app, ACCELERATOR_SETTING)
        .and_then(|v| v.as_str().map(str::to_string))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| default_accelerator().to_string())
}

fn enabled_setting(app: &AppHandle) -> bool {
    crate::settings::read_setting(app, ENABLED_SETTING)
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// Brings the registration in line with Settings and tells every window
/// how that went. From startup and from settings_patch whenever a Quick
/// Note shortcut field changes. On the main thread - inline when called
/// there, as both are: the hotkey manager has to be created on it (on
/// Windows it is a window whose thread receives the key events), and the
/// plugin's register waits for it.
pub fn apply(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || apply_now(&handle));
}

fn apply_now(app: &AppHandle) {
    let status = register(app);
    if let Some(state) = app.try_state::<ShortcutStatus>() {
        *state.0.lock().unwrap() = Some(status.clone());
    }
    for label in app.webview_windows().into_keys() {
        let _ = app.emit_to(
            tauri::EventTarget::webview_window(&label),
            STATUS_EVENT,
            status.clone(),
        );
    }
}

fn register(app: &AppHandle) -> Status {
    let accelerator = accelerator_setting(app);
    let loaded = PLUGIN_LOADED.load(Ordering::Relaxed);
    if loaded {
        // Whatever was registered before goes first: a changed combination
        // must not leave the old one listening too.
        let _ = app.global_shortcut().unregister_all();
    }
    if !enabled_setting(app) {
        return Status::new("off", &accelerator);
    }
    // No Wayland compositor lets an app grab a key for the whole desktop;
    // the X11 grab the plugin uses would only see keys typed into X windows.
    // The user binds `textus --quick-note` in the desktop's own settings
    // instead (Settings shows the command).
    #[cfg(target_os = "linux")]
    if crate::is_wayland() {
        return Status::new("wayland", &accelerator);
    }
    let shortcut = match validate(&accelerator, Os::current()) {
        Ok(shortcut) => shortcut,
        Err(invalid) => {
            return Status {
                reason: Some(invalid.name()),
                ..Status::new("invalid", &accelerator)
            }
        }
    };
    if !loaded {
        let plugin = tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    super::window::open_soon(app);
                }
            })
            .build();
        if app.plugin(plugin).is_err() {
            return Status::new("inUse", &accelerator);
        }
        PLUGIN_LOADED.store(true, Ordering::Relaxed);
    }
    match app.global_shortcut().register(shortcut) {
        Ok(()) => Status::new("on", &accelerator),
        // The OS refused it: another app (OneNote's Win+Alt+N, a launcher)
        // already holds the combination.
        Err(_) => Status::new("inUse", &accelerator),
    }
}

/// The shortcut's current state, for Settings as it opens; the event above
/// keeps it current after that.
#[tauri::command]
pub fn quick_note_shortcut_status(app: AppHandle, state: tauri::State<ShortcutStatus>) -> Status {
    if let Some(status) = state.0.lock().unwrap().clone() {
        return status;
    }
    // Never applied this run: the shortcut has been off since launch.
    Status::new("off", &accelerator_setting(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_defaults_are_valid_where_they_apply() {
        assert!(validate("Control+Alt+N", Os::Mac).is_ok());
        assert!(validate("Control+Alt+N", Os::Linux).is_ok());
        assert!(validate("Super+Alt+N", Os::Windows).is_ok());
        assert!(validate(default_accelerator(), Os::current()).is_ok());
    }

    #[test]
    fn a_shortcut_needs_two_modifiers_or_a_function_key() {
        for os in [Os::Mac, Os::Windows, Os::Linux] {
            assert_eq!(validate("Control+N", os), Err(Invalid::TooFewModifiers));
            assert_eq!(validate("Super+S", os), Err(Invalid::TooFewModifiers));
            assert_eq!(validate("N", os), Err(Invalid::TooFewModifiers));
            assert_eq!(validate("F8", os), Err(Invalid::TooFewModifiers));
            assert!(validate("Control+F8", os).is_ok());
            assert!(validate("Control+Shift+Space", os).is_ok());
        }
    }

    #[test]
    fn windows_refuses_ctrl_alt_letters_which_are_altgr_there() {
        assert_eq!(validate("Control+Alt+N", Os::Windows), Err(Invalid::AltGr));
        assert_eq!(
            validate("Control+Alt+Shift+N", Os::Windows),
            Err(Invalid::AltGr)
        );
        assert!(validate("Control+Alt+F9", Os::Windows).is_ok());
        assert!(validate("Super+Control+Alt+N", Os::Windows).is_ok());
    }

    #[test]
    fn os_shortcuts_are_refused() {
        assert_eq!(
            validate("Control+Super+Space", Os::Mac),
            Err(Invalid::Reserved)
        );
        assert_eq!(validate("Super+Shift+4", Os::Mac), Err(Invalid::Reserved));
        assert_eq!(
            validate("Control+Alt+Delete", Os::Windows),
            Err(Invalid::Reserved)
        );
        assert_eq!(
            validate("Super+Shift+S", Os::Windows),
            Err(Invalid::Reserved)
        );
        assert_eq!(validate("Control+Alt+T", Os::Linux), Err(Invalid::Reserved));
        assert_eq!(
            validate("Control+Alt+F3", Os::Linux),
            Err(Invalid::Reserved)
        );
        assert_eq!(validate("Alt+Shift+Tab", Os::Mac), Err(Invalid::Reserved));
        assert_eq!(validate("Control+Alt+F4", Os::Mac), Err(Invalid::Reserved));
        // What one OS reserves another may not.
        assert!(validate("Control+Alt+T", Os::Mac).is_ok());
    }

    #[test]
    fn nonsense_is_unparsable() {
        assert_eq!(validate("", Os::Linux), Err(Invalid::Unparsable));
        assert_eq!(validate("Control+", Os::Linux), Err(Invalid::Unparsable));
        assert_eq!(validate("Hyper+Q", Os::Linux), Err(Invalid::Unparsable));
    }

    #[test]
    fn every_reserved_entry_parses() {
        // A typo would silently reserve nothing.
        for os in [Os::Mac, Os::Windows, Os::Linux] {
            for accel in reserved(os) {
                assert!(Shortcut::from_str(accel).is_ok(), "{accel}");
            }
        }
    }
}
