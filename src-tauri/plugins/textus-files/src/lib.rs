//! iOS and Android document access for Textus.
//!
//! An iOS app can't open arbitrary paths: a file or folder the user picks in
//! the Files app arrives as a security-scoped URL that has to be opened for
//! access around every read and write, through a file coordinator (iCloud
//! may be syncing it), and that must be saved as a bookmark to survive a
//! relaunch. That is native work, so it lives in
//! `ios/Sources/TextusFilesPlugin.swift`; this crate only forwards the
//! frontend's calls to it.
//!
//! Files in the app's own Documents folder (shown in Files as "On My
//! iPhone > Textus") don't need any of this and keep using the app's
//! ordinary Rust file commands.
//!
//! Android's picks are content:// URLs read through the ContentResolver in
//! `android/src/main/java/TextusFilesPlugin.kt`, the Swift plugin's twin.
//!
//! Registered on mobile only (see the app's lib.rs); desktop never loads it.

#[cfg(any(target_os = "ios", target_os = "android"))]
mod native {
    use serde_json::Value;
    use tauri::{
        plugin::{Builder, PluginHandle, TauriPlugin},
        AppHandle, Manager, Runtime,
    };

    #[cfg(target_os = "ios")]
    tauri::ios_plugin_binding!(init_plugin_textus_files);

    struct Native<R: Runtime>(PluginHandle<R>);

    /// Calls a method of the Swift plugin with the command's arguments as they
    /// came from the frontend, and hands its answer straight back.
    fn forward<R: Runtime>(app: &AppHandle<R>, method: &str, args: Value) -> Result<Value, String> {
        app.state::<Native<R>>()
            .0
            .run_mobile_plugin::<Value>(method, args)
            .map_err(|err| err.to_string())
    }

    macro_rules! forwarded {
        ($($name:ident => $method:literal),* $(,)?) => {
            $(
                #[tauri::command]
                async fn $name<R: Runtime>(app: AppHandle<R>, args: Option<Value>) -> Result<Value, String> {
                    forward(&app, $method, args.unwrap_or(Value::Null))
                }
            )*
        };
    }

    forwarded! {
        pick_document => "pickDocument",
        pick_folder => "pickFolder",
        create_document => "createDocument",
        read_text => "readText",
        read_data => "readData",
        write_text => "writeText",
        list_folder => "listFolder",
        create_entry => "createEntry",
        rename_entry => "renameEntry",
        move_entry => "moveEntry",
        delete_entry => "deleteEntry",
        trash => "trash",
        remembered => "remembered",
        begin_access => "beginAccess",
        share => "share",
        haptic => "haptic",
        appearance => "appearance",
    }

    /// File > Export as PDF, drawn by the Swift plugin (iOS only): `args` as
    /// the app's export_pdf_native has them.
    #[cfg(target_os = "ios")]
    pub fn export_pdf<R: Runtime>(app: &AppHandle<R>, args: Value) -> Result<(), String> {
        forward(app, "exportPdf", args).map(|_| ())
    }

    pub fn init<R: Runtime>() -> TauriPlugin<R> {
        Builder::new("textus-files")
            .invoke_handler(tauri::generate_handler![
                pick_document,
                pick_folder,
                create_document,
                read_text,
                read_data,
                write_text,
                list_folder,
                create_entry,
                rename_entry,
                move_entry,
                delete_entry,
                trash,
                remembered,
                begin_access,
                share,
                haptic,
                appearance
            ])
            .setup(|app, api| {
                #[cfg(target_os = "ios")]
                let handle = api.register_ios_plugin(init_plugin_textus_files)?;
                #[cfg(target_os = "android")]
                let handle =
                    api.register_android_plugin("com.catvinci.textus.files", "TextusFilesPlugin")?;
                app.manage(Native(handle));
                Ok(())
            })
            .build()
    }
}

#[cfg(target_os = "ios")]
pub use native::export_pdf;
#[cfg(any(target_os = "ios", target_os = "android"))]
pub use native::init;

#[cfg(test)]
mod tests {
    /// Every command build.rs allows must be forwarded and registered: one
    /// left out (trash was) reaches Swift with the raw payload and fails
    /// there, on every call.
    #[test]
    fn every_allowed_command_is_forwarded_and_registered() {
        let build = include_str!("../build.rs");
        let lib = include_str!("lib.rs");
        let list = build.split("COMMANDS").nth(1).unwrap();
        let list = &list[..list.find("];").unwrap()];
        let handler = lib.split("generate_handler![").nth(1).unwrap();
        let handler = &handler[..handler.find(']').unwrap()];
        for name in list.split('"').skip(1).step_by(2) {
            assert!(
                lib.contains(&format!("{name} => ")),
                "{name} isn't forwarded"
            );
            assert!(
                handler.split(',').any(|n| n.trim() == name),
                "{name} isn't registered"
            );
        }
    }
}
