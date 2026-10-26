//! Pictures from Textus AI: the image model chosen in Settings (none by
//! default, as a picture costs money), the generate_image tool, and the pictures
//! waiting in memory for the user's decision. Only Accept saves one.

use crate::ai::agent::StreamEvent;
use crate::ai::tools::{Access, ProposalLedger, Run, Tool, EDITING_MODES};
use aicompat::agent::{AgentTurn, ImageAttachment, ToolCall, ToolOutput, ToolSpec};
use aicompat::images::{self as gen, Aspect, GeneratedImage, ImageApi, ImageTarget};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::AppHandle;

mod services;
pub(crate) use services::*;
mod undecided;
pub(crate) use undecided::*;
mod run;
pub(crate) use run::*;
mod pending;
pub(crate) use pending::*;

mod inline;

pub use inline::InlinePictures;

pub const GENERATE_IMAGE_TOOL_NAME: &str = "generate_image";

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn list_image_providers() -> Vec<ImageProviderEntry> {
    IMAGE_PROVIDERS.to_vec()
}

/// A picture, once it is made: the frame in the document waits on this.
/// Its error is why it wasn't made, in the service's words.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn ai_generated_image(id: String) -> Result<GeneratedImageData, String> {
    let deadline = std::time::Instant::now() + WAIT_FOR_PICTURE;
    loop {
        if let Some(found) = look(&id) {
            return found;
        }
        if std::time::Instant::now() >= deadline {
            return Err("The image service didn't send the picture in time.".to_string());
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}

/// Asks again for a picture that wasn't made - the same description, to
/// the same service - leaving the others alone; ai_generated_image then
/// waits for it as for any picture.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn ai_retry_generated_image(id: String) -> Result<(), String> {
    retry(&id)
}

/// The description a proposed picture was drawn from, for the writer to
/// change (ai_redraw_generated_image); none once it is gone.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn ai_generated_image_prompt(id: String) -> Option<String> {
    prompt_of(&id)
}

/// Draws a proposed picture again from the writer's description, leaving
/// the others alone; ai_generated_image then waits for it as for any
/// picture.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn ai_redraw_generated_image(id: String, prompt: String) -> Result<(), String> {
    redraw(&id, prompt)
}

/// Lets a picture go: its proposal was rejected, or it was saved. One
/// still being made is let go too; what it makes is thrown away.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn ai_discard_generated_image(id: String) {
    pending().retain(|(i, _)| *i != id);
}

#[cfg(test)]
mod tests;
