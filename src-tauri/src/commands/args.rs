//! A command's frontend inputs as one struct, read from the whole invoke
//! payload rather than from one key of it. Tauri hands each command
//! parameter its own key (`invoke("ai_complete", { before, after, ... })`),
//! so a command with many inputs grew a parameter per key; with `Args` the
//! keys become the fields of a `#[serde(rename_all = "camelCase")]` struct
//! and the frontend's call stays exactly as it was.

use serde::de::DeserializeOwned;
use tauri::ipc::{CommandArg, CommandItem, InvokeBody, InvokeError};
use tauri::Runtime;

/// The invoke payload's keys as the fields of `T`. Not `Deserialize` itself,
/// which is what lets it have a `CommandArg` of its own beside Tauri's
/// per-key one for every deserializable type.
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
