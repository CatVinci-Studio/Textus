//! Windows: a WinRT toast. Its click is a protocol activation of
//! `textus://notification/<id>`, the scheme Textus already answers: a running
//! Textus gets it through single-instance and deep-link, and one that has quit
//! is started with it. The toast names the app by the id the installer gives
//! its shortcut; a development build borrows PowerShell's, as
//! tauri-plugin-notification does.

use windows::core::HSTRING;
use windows::Data::Xml::Dom::XmlDocument;
use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

const POWERSHELL_APP_ID: &str =
    "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

pub fn install(_app: &tauri::AppHandle) {}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// The toast's XML: its text, and the link its click opens.
fn toast_xml(id: &str, title: &str, body: &str) -> String {
    format!(
        "<toast activationType=\"protocol\" launch=\"{scheme}://notification/{id}\">\
         <visual><binding template=\"ToastGeneric\"><text>{title}</text><text>{body}</text></binding></visual>\
         </toast>",
        scheme = crate::plugins::uri::SCHEME,
        title = escape(title),
        body = escape(body),
    )
}

pub fn show(app: &tauri::AppHandle, id: &str, title: &str, body: &str) -> Result<bool, String> {
    let app_id = if cfg!(debug_assertions) {
        POWERSHELL_APP_ID.to_string()
    } else {
        app.config().identifier.clone()
    };
    let doc = XmlDocument::new().map_err(|e| e.to_string())?;
    doc.LoadXml(&HSTRING::from(toast_xml(id, title, body)))
        .map_err(|e| e.to_string())?;
    let toast = ToastNotification::CreateToastNotification(&doc).map_err(|e| e.to_string())?;
    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))
        .and_then(|notifier| notifier.Show(&toast))
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_toast_escapes_its_text_and_links_to_its_id() {
        let xml = toast_xml("abc", "Tea & <cake>", "\"now\"");
        assert!(xml.contains("launch=\"textus://notification/abc\""));
        assert!(xml.contains("Tea &amp; &lt;cake&gt;"));
        assert!(xml.contains("&quot;now&quot;"));
    }
}
