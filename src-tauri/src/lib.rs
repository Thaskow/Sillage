mod accounts;
mod commands;
mod terminals;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use sillage_core::{OpenOutcome, Store};
use sillage_pty::PtyManager;
use tauri::{Manager, RunEvent};

pub struct AppState {
    pub store: Mutex<Store>,
    pub open_outcome: OpenOutcome,
    pub pty: PtyManager,
    pub data_dir: PathBuf,
    pub exiting: Arc<AtomicBool>,
}

#[cfg(windows)]
fn lock_webview(w: &tauri::WebviewWindow) {
    let _ = w.with_webview(|wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows_core::Interface;
        let Ok(core) = wv.controller().CoreWebView2() else {
            return;
        };
        let Ok(settings) = core.Settings() else {
            return;
        };
        let _ = settings.SetAreDefaultContextMenusEnabled(false);
        if !cfg!(debug_assertions) {
            let _ = settings.SetAreDevToolsEnabled(false);
        }
        if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
            let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
        }
    });
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let dir = app.path().app_local_data_dir()?;
            let (store, open_outcome) = Store::open(&dir.join("sillage.db"))?;
            store.ensure_scratch_group()?;
            app.manage(AppState {
                store: Mutex::new(store),
                open_outcome,
                pty: PtyManager::new(),
                data_dir: dir,
                exiting: Arc::new(AtomicBool::new(false)),
            });
            if let Some(w) = app.get_webview_window("main") {
                #[cfg(windows)]
                lock_webview(&w);
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(2500));
                    let _ = w.show();
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::get_settings,
            commands::save_settings,
            commands::list_workspace,
            commands::create_group,
            commands::update_group,
            commands::delete_group,
            commands::reorder_groups,
            commands::duplicate_group,
            commands::create_category,
            commands::update_category,
            commands::delete_category,
            accounts::list_profiles,
            accounts::create_profile,
            accounts::update_profile,
            accounts::delete_profile,
            accounts::set_session_profile,
            accounts::copy_mcp_servers,
            accounts::usage_report,
            terminals::available_kinds,
            terminals::list_sessions,
            terminals::create_session,
            terminals::rename_session,
            terminals::move_session,
            terminals::delete_session,
            terminals::start_session,
            terminals::write_session,
            terminals::resize_session,
            terminals::kill_session,
            terminals::running_sessions,
            terminals::reset_agent_session,
        ])
        .build(tauri::generate_context!())
        .expect("échec du démarrage de Sillage");

    app.run(|handle, event| match event {
        RunEvent::ExitRequested { .. } => {
            handle
                .state::<AppState>()
                .exiting
                .store(true, Ordering::SeqCst);
        }
        RunEvent::Exit => {
            let state = handle.state::<AppState>();
            state.exiting.store(true, Ordering::SeqCst);
            terminals::shutdown(&state.pty);
        }
        _ => {}
    });
}
