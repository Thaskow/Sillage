use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use sillage_core::hooks::{self, Activity};
use tauri::{AppHandle, Emitter};

/// `sillage.exe --hook <activity>`, called by Claude Code; returns false outside hook mode.
pub fn run_cli() -> bool {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("--hook") {
        return false;
    }
    let activity = args.next().as_deref().and_then(Activity::parse);
    let id = std::env::var(hooks::ENV_SESSION).ok();
    let dir = std::env::var_os(hooks::ENV_DIR).map(PathBuf::from);
    if let (Some(a), Some(id), Some(dir)) = (activity, id, dir) {
        let _ = hooks::write_state(&dir, &id, a, sillage_core::now_ms());
    }
    true
}

pub fn path_with_exe_dir() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.to_str()?.to_string();
    Some(match std::env::var("PATH") {
        Ok(p) if !p.is_empty() => format!("{p};{dir}"),
        _ => dir,
    })
}

pub fn dir(data_dir: &Path) -> PathBuf {
    data_dir.join("hooks")
}

pub fn prepare(data_dir: &Path) -> Option<serde_json::Value> {
    std::fs::create_dir_all(dir(data_dir)).ok()?;
    let _ = std::fs::remove_file(data_dir.join("claude-hooks.json"));
    hooks::claude_settings(&std::env::current_exe().ok()?)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivityEvent {
    id: String,
    activity: Activity,
    at: i64,
}

pub fn watch(app: AppHandle, dir: PathBuf) {
    std::thread::spawn(move || {
        let mut seen: HashMap<String, (Activity, i64)> = HashMap::new();
        loop {
            let now = hooks::read_states(&dir);
            for (id, v) in &now {
                if seen.get(id) != Some(v) {
                    let _ = app.emit(
                        "agent-activity",
                        ActivityEvent {
                            id: id.clone(),
                            activity: v.0,
                            at: v.1,
                        },
                    );
                }
            }
            seen = now;
            std::thread::sleep(Duration::from_millis(300));
        }
    });
}
