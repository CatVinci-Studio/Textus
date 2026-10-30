//! Linux: org.freedesktop.Notifications over D-Bus, with a "default" action
//! the server invokes on a click, heard by one thread listening while Textus
//! runs. After Textus quit a click does nothing; a server without actions
//! gets the activation fallback.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::Value;

const DEST: &str = "org.freedesktop.Notifications";
const PATH: &str = "/org/freedesktop/Notifications";

struct Bus {
    connection: Connection,
    /// Whether the server shows actions.
    actions: bool,
    /// The server's ids of ours.
    ids: Mutex<HashMap<u32, String>>,
}

static BUS: OnceLock<Option<Bus>> = OnceLock::new();

fn proxy(connection: &Connection) -> zbus::Result<Proxy<'static>> {
    Proxy::new(connection, DEST, PATH, DEST)
}

/// The session bus, its server's capabilities and the click listener, set
/// up on first use.
fn bus(app: &tauri::AppHandle) -> Option<&'static Bus> {
    BUS.get_or_init(|| {
        let connection = Connection::session().ok()?;
        let capabilities: Vec<String> = proxy(&connection)
            .ok()?
            .call("GetCapabilities", &())
            .unwrap_or_default();
        let actions = capabilities.iter().any(|c| c == "actions");
        if actions {
            listen(app.clone(), connection.clone());
        }
        Some(Bus {
            connection,
            actions,
            ids: Mutex::new(HashMap::new()),
        })
    })
    .as_ref()
}

fn listen(app: tauri::AppHandle, connection: Connection) {
    std::thread::spawn(move || {
        let Ok(proxy) = proxy(&connection) else {
            return;
        };
        let Ok(signals) = proxy.receive_signal("ActionInvoked") else {
            return;
        };
        for message in signals {
            let Ok((server_id, _action)) = message.body().deserialize::<(u32, String)>() else {
                continue;
            };
            let ours = BUS
                .get()
                .and_then(|b| b.as_ref())
                .and_then(|b| b.ids.lock().ok()?.remove(&server_id));
            if let Some(id) = ours {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || super::clicked(&handle, &id));
            }
        }
    });
}

pub fn install(_app: &tauri::AppHandle) {}

pub fn show(app: &tauri::AppHandle, id: &str, title: &str, body: &str) -> Result<bool, String> {
    let bus = bus(app).ok_or("No notification server on the session bus.")?;
    let actions: Vec<&str> = if bus.actions {
        vec!["default", crate::app_identity::APP_NAME]
    } else {
        Vec::new()
    };
    let mut hints: HashMap<&str, Value<'_>> = HashMap::new();
    hints.insert(
        "desktop-entry",
        Value::from(crate::app_identity::ORIGINATOR),
    );
    let server_id: u32 = proxy(&bus.connection)
        .and_then(|p| {
            p.call(
                "Notify",
                &(
                    crate::app_identity::APP_NAME,
                    0u32,
                    crate::app_identity::ORIGINATOR,
                    title,
                    body,
                    actions,
                    hints,
                    -1i32,
                ),
            )
        })
        .map_err(|e| e.to_string())?;
    if bus.actions {
        if let Ok(mut ids) = bus.ids.lock() {
            // Ones never clicked are let go, a few hundred on.
            if ids.len() >= 256 {
                ids.clear();
            }
            ids.insert(server_id, id.to_string());
        }
    }
    Ok(bus.actions)
}
