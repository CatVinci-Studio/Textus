//! Messages the user sends into a reply still running (`ai_agent_message`),
//! keyed by its request id: the agent loop reads them between steps, as the
//! user's next words, and goes on with them in mind. A static registry, as
//! `ai::cancel` is.

use std::collections::HashMap;
use std::sync::Mutex;

static INBOXES: Mutex<Option<HashMap<String, Vec<String>>>> = Mutex::new(None);

/// The request's inbox, open while it runs; closed when the guard goes,
/// however the request ends.
pub struct Inbox(String);

impl Inbox {
    pub fn open(request_id: &str) -> Self {
        INBOXES
            .lock()
            .unwrap()
            .get_or_insert_with(HashMap::new)
            .insert(request_id.to_string(), Vec::new());
        Self(request_id.to_string())
    }

    /// The messages sent in since it was last read, oldest first.
    pub fn take(&self) -> Vec<String> {
        INBOXES
            .lock()
            .unwrap()
            .as_mut()
            .and_then(|map| map.get_mut(&self.0))
            .map(std::mem::take)
            .unwrap_or_default()
    }
}

impl Drop for Inbox {
    fn drop(&mut self) {
        if let Some(map) = INBOXES.lock().unwrap().as_mut() {
            map.remove(&self.0);
        }
    }
}

/// Puts `message` into the running request's inbox. False when no request of
/// that id is running: the caller sends it as a message of its own.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn ai_steer(request_id: String, message: String) -> bool {
    match INBOXES
        .lock()
        .unwrap()
        .as_mut()
        .and_then(|map| map.get_mut(&request_id))
    {
        Some(inbox) => {
            inbox.push(message);
            true
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_running_request_takes_messages_and_a_closed_one_refuses_them() {
        assert!(!ai_steer("r1".into(), "early".into()));
        let inbox = Inbox::open("r1");
        assert!(ai_steer("r1".into(), "one".into()));
        assert!(ai_steer("r1".into(), "two".into()));
        assert_eq!(inbox.take(), vec!["one", "two"]);
        assert!(inbox.take().is_empty());
        drop(inbox);
        assert!(!ai_steer("r1".into(), "late".into()));
    }
}
