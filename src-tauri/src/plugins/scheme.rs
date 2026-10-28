//! `textus-plugin://localhost/<id>/<path>`: a plugin's own files, by URL, for
//! its sandboxed frames. Inlined as `data:` URLs instead, a large module
//! (PlantUML's 3 MB engine) took WebKit gigabytes to load.

use super::access::{inside, plugin_home};
use super::state;
use percent_encoding::percent_decode_str;
use std::path::Path;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::UriSchemeResponder;

pub const SCHEME: &str = "textus-plugin";

/// Answers one request off the main thread.
pub fn handle(app: &tauri::AppHandle, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = app.clone();
    let path = request.uri().path().to_string();
    tauri::async_runtime::spawn(async move {
        let response = match file(&app, &path).await {
            Ok((bytes, mime)) => Response::builder()
                .header(header::CONTENT_TYPE, mime)
                .body(bytes),
            Err(_) => Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Vec::new()),
        };
        // The frames' origin is opaque: a module script is only run from a
        // response that lets any origin have it.
        responder.respond(response.map_or_else(
            |_| Response::new(Vec::new()),
            |mut r| {
                r.headers_mut().insert(
                    header::ACCESS_CONTROL_ALLOW_ORIGIN,
                    header::HeaderValue::from_static("*"),
                );
                r
            },
        ));
    });
}

/// The file `path` (`/<id>/<rel>`) names, inside that plugin's own folder.
async fn file(app: &tauri::AppHandle, path: &str) -> Result<(Vec<u8>, &'static str), String> {
    let path = percent_decode_str(path.trim_start_matches('/'))
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    let (id, rel) = path.split_once('/').ok_or("No file named.")?;
    let home = plugin_home(app, &state::read(app), id)?;
    let file = inside(&home, Path::new(rel))?;
    let bytes = tokio::fs::read(&file).await.map_err(|e| e.to_string())?;
    Ok((bytes, mime(rel)))
}

fn mime(rel: &str) -> &'static str {
    let ext = rel.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some("js" | "mjs") => "text/javascript",
        Some("css") => "text/css",
        Some("html") => "text/html",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::mime;

    #[test]
    fn a_module_is_served_as_javascript() {
        assert_eq!(mime("lib/plantuml.js"), "text/javascript");
        assert_eq!(mime("lib/wasm/qcms_bg.wasm"), "application/wasm");
        assert_eq!(mime("lib/cmaps/GB-H.bcmap"), "application/octet-stream");
    }
}
