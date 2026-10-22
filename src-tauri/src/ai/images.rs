//! Pictures from Textus AI (#194): the image model chosen in Settings ›
//! Textus AI (none by default - a picture costs money, and most chat models
//! can't make one), the generate_image tool the agent gets while one is
//! chosen, and the pictures waiting for the user's decision.
//!
//! A picture is a proposal like any other edit. The tool runs the request
//! ([`ImageRun::execute`]) and keeps the picture here, in memory; the
//! frontend shows it in place with Accept and Reject, and only Accept
//! saves it - into the image folder, under the naming rules, or up to the
//! image host, as Settings › Images says for a pasted picture - and writes
//! the Markdown image. Reject, or closing the app, leaves nothing behind.
//! The protocol of each service is aicompat::images. Ideas from #221 by
//! Zhuohang Jiang: the per-send cap, the checked download, refusals told
//! apart from failures.

use crate::ai::agent::StreamEvent;
use crate::ai::tools::{self, Access, ProposalLedger, Run, Tool, EDITING_MODES};
use aicompat::agent::{AgentTurn, ToolCall, ToolOutput, ToolSpec};
use aicompat::images::{self as gen, Aspect, GeneratedImage, ImageApi, ImageTarget};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::ipc::Channel;
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
pub fn list_image_providers() -> Vec<ImageProviderEntry> {
    IMAGE_PROVIDERS.to_vec()
}

/// A picture, once it is made: the frame in the document waits on this.
/// Its error is why it wasn't made, in the service's words.
#[tauri::command]
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

/// Lets a picture go: its proposal was rejected, or it was saved. One
/// still being made is let go too; what it makes is thrown away.
#[tauri::command]
pub fn ai_discard_generated_image(id: String) {
    pending().retain(|(i, _)| *i != id);
}

#[cfg(test)]
mod tests;
