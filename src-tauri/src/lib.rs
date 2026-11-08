//! Sawhorse desktop shell.
//!
//! Deliberately thin: the front end (the same Vite build as the browser demo) runs the
//! Rust kernel as WASM inside the webview (ADR-0001), so geometry never crosses IPC.
//! Native-only concerns live here: file dialogs and file access (lane 6: the dialog and fs
//! plugins), drag-and-drop of files onto the window, the render-credit device key in the
//! OS secure store (lane 8, ADR-0004, `device-key/`) and opening Stripe Checkout in the
//! system browser, and showing a plugin's folder (lane 11). The .shz file association lands
//! in a later lane.
//!
//! File access is scoped: the fs plugin may only touch paths the user picked in a dialog
//! (the dialog plugin adds them to the scope) or dropped on the window (added below).

use std::sync::Mutex;

use sawhorse_device_key::{external_url_allowed, DeviceKey, KeyringStore};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_fs::FsExt;
use tauri_plugin_opener::OpenerExt;

/// Reports the shell version to the front end (smoke test for IPC).
#[tauri::command]
fn shell_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// The device key, loaded from (or created in) the OS keychain on first use.
#[derive(Default)]
struct Device(Mutex<Option<DeviceKey>>);

fn with_key<T>(
    state: &Device,
    f: impl FnOnce(&DeviceKey) -> Result<T, String>,
) -> Result<T, String> {
    let mut slot = state
        .0
        .lock()
        .map_err(|_| "device key lock poisoned".to_string())?;
    if slot.is_none() {
        let store = KeyringStore::new().map_err(|e| e.to_string())?;
        *slot = Some(DeviceKey::load_or_create(&store).map_err(|e| e.to_string())?);
    }
    f(slot.as_ref().expect("set above"))
}

/// The device's Ed25519 public key, base64url (the private key never leaves Rust).
// Commands that wait on the disk or the Keychain run off the main thread: a plain command
// runs on it, and the app's window stops responding until it returns.
#[tauri::command(async)]
fn device_public_key(state: State<'_, Device>) -> Result<String, String> {
    with_key(&state, |k| Ok(k.public_key_b64()))
}

/// Sign a render-service request (base64url bytes in, base64url signature out).
#[tauri::command(async)]
fn device_sign(state: State<'_, Device>, message: String) -> Result<String, String> {
    with_key(&state, |k| k.sign_b64(&message).map_err(|e| e.to_string()))
}

/// Open a checkout page in the system browser. Only Stripe Checkout (and the render
/// service's simulated checkout on loopback, in development) is allowed.
#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !external_url_allowed(&url) {
        return Err(format!(
            "refusing to open {url}: only checkout pages open from the app"
        ));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Show a plugin's folder in the system file manager (lane 11, the Plugins pane's "Open
/// folder"). Only a folder that holds a plugin.json is opened, so the page cannot use this
/// to open arbitrary paths.
#[tauri::command]
fn open_plugin_folder(app: AppHandle, path: String) -> Result<(), String> {
    let dir = std::path::PathBuf::from(&path);
    if !dir.is_dir() || !dir.join("plugin.json").is_file() {
        return Err(format!("{path} is not a plugin folder"));
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Save a file without ever leaving it half written (lane 16, `sawhorse-safe-save`): the
/// bytes are the request's raw body, the path a percent-encoded `x-path` header. Only a path
/// in the fs scope (one the person picked in a Save dialog, or opened) is written.
#[tauri::command(async)]
fn save_file_atomic(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("save_file_atomic takes the file's bytes as its body".into());
    };
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .and_then(sawhorse_safe_save::percent_decode)
        .ok_or("save_file_atomic needs the path in its x-path header")?;
    let path = std::path::PathBuf::from(path);
    if !app.fs_scope().is_allowed(&path) {
        return Err(format!(
            "{} was not chosen in a Save dialog",
            path.display()
        ));
    }
    sawhorse_safe_save::write_atomic(&path, bytes).map_err(|e| e.to_string())
}

/// The menu item that stands in for macOS's standard Quit.
#[cfg(target_os = "macos")]
const QUIT_ITEM: &str = "sawhorse-quit";

/// The standard menu, with Quit going through the window. macOS's own Quit item ends the
/// app at once, past the window's close request, so unsaved work would go without a question.
#[cfg(target_os = "macos")]
fn menu_asking_before_quit<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    let menu = Menu::default(app)?;
    for top in menu.items()? {
        let MenuItemKind::Submenu(sub) = top else {
            continue;
        };
        for (at, item) in sub.items()?.into_iter().enumerate() {
            let MenuItemKind::Predefined(p) = &item else {
                continue;
            };
            if p.text()?.starts_with("Quit") {
                sub.remove(&item)?;
                let quit =
                    MenuItem::with_id(app, QUIT_ITEM, "Quit Sawhorse", true, Some("CmdOrCtrl+Q"))?;
                sub.insert(&quit, at)?;
                return Ok(menu);
            }
        }
    }
    Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(menu_asking_before_quit)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == QUIT_ITEM {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.close();
                }
            }
        });
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Device::default())
        .on_window_event(|window, event| {
            // Files dropped on the window: allow exactly those paths, then tell the page,
            // which reads them through the fs plugin (src/io/files.ts, onTauriDrop).
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let scope = window.app_handle().fs_scope();
                for p in paths {
                    let _ = scope.allow_file(p);
                }
                let _ = window.emit("sawhorse://dropped", paths);
            }
        })
        .invoke_handler(tauri::generate_handler![
            shell_version,
            device_public_key,
            device_sign,
            open_external,
            open_plugin_folder,
            save_file_atomic
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sawhorse");
}
