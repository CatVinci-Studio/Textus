// The command list is also the permission list (permissions/default.toml
// allows them all). Each one is a method of TextusFilesPlugin.swift and
// TextusFilesPlugin.kt (create_document and the *_entry ones: Android only;
// trash: iOS only).
const COMMANDS: &[&str] = &[
    "pick_document",
    "pick_folder",
    "create_document",
    "read_text",
    "read_data",
    "write_text",
    "list_folder",
    "create_entry",
    "rename_entry",
    "move_entry",
    "delete_entry",
    "trash",
    "remembered",
    "begin_access",
    "share",
    "haptic",
    "appearance",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .android_path("android")
        .build();
}
