//! A command's inputs read from the whole invoke payload as one
//! `#[serde(rename_all = "camelCase")]` struct, rather than a parameter per key.

use serde::de::DeserializeOwned;
use tauri::ipc::{CommandArg, CommandItem, InvokeBody, InvokeError};
use tauri::Runtime;

/// The invoke payload's keys as the fields of `T`. Not `Deserialize` itself,
/// so it can have its own `CommandArg` beside Tauri's per-key one.
pub struct Args<T>(pub T);

impl<'de, T: DeserializeOwned, R: Runtime> CommandArg<'de, R> for Args<T> {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        let parsed = match command.message.payload() {
            InvokeBody::Json(value) => T::deserialize(value).map_err(|e| {
                InvokeError::from(tauri::Error::InvalidArgs(command.name, command.key, e))
            }),
            InvokeBody::Raw(_) => Err(InvokeError::from(format!(
                "command {} expected a JSON payload, not bytes",
                command.name
            ))),
        };
        parsed.map(Args)
    }
}
