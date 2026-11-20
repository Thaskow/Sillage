use std::sync::PoisonError;

use serde::Serialize;
use sillage_core::settings::Settings;
use sillage_core::workspace::{Category, Group, GroupPatch, NewGroup};
use sillage_core::{OpenOutcome, Result, Store};
use tauri::State;

use crate::AppState;

pub(crate) fn with_store<T>(
    state: &State<AppState>,
    f: impl FnOnce(&mut Store) -> Result<T>,
) -> Result<T> {
    f(&mut state.store.lock().unwrap_or_else(PoisonError::into_inner))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: &'static str,
    schema_version: usize,
    storage: OpenOutcome,
}

#[tauri::command]
pub fn app_info(state: State<AppState>) -> Result<AppInfo> {
    let schema_version = with_store(&state, |s| s.schema_version())?;
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        schema_version,
        storage: state.open_outcome.clone(),
    })
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<Settings> {
    with_store(&state, |s| s.settings())
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: Settings) -> Result<Settings> {
    with_store(&state, |s| s.save_settings(settings))
}

#[derive(Serialize)]
pub struct Workspace {
    groups: Vec<Group>,
    categories: Vec<Category>,
}

#[tauri::command]
pub fn list_workspace(state: State<AppState>) -> Result<Workspace> {
    with_store(&state, |s| {
        Ok(Workspace {
            groups: s.groups()?,
            categories: s.categories()?,
        })
    })
}

#[tauri::command]
pub fn create_group(state: State<AppState>, group: NewGroup) -> Result<Group> {
    with_store(&state, |s| s.create_group(group))
}

#[tauri::command]
pub fn update_group(state: State<AppState>, id: String, patch: GroupPatch) -> Result<Group> {
    with_store(&state, |s| s.update_group(&id, patch))
}

#[tauri::command]
pub async fn delete_group(state: State<'_, AppState>, id: String) -> Result<()> {
    let sessions = with_store(&state, |s| s.sessions())?;
    with_store(&state, |s| s.delete_group(&id))?;
    for d in sessions.iter().filter(|d| d.group_id == id) {
        if state.pty.is_running(&d.id) {
            let _ = state.pty.kill(&d.id);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn reorder_groups(state: State<AppState>, ids: Vec<String>) -> Result<Vec<Group>> {
    with_store(&state, |s| s.reorder_groups(&ids))
}

#[tauri::command]
pub fn duplicate_group(state: State<AppState>, id: String) -> Result<Group> {
    with_store(&state, |s| s.duplicate_group(&id))
}

#[tauri::command]
pub fn create_category(state: State<AppState>, name: String) -> Result<Category> {
    with_store(&state, |s| s.create_category(&name))
}

#[tauri::command]
pub fn update_category(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    collapsed: Option<bool>,
) -> Result<()> {
    with_store(&state, |s| s.update_category(&id, name, collapsed))
}

#[tauri::command]
pub fn delete_category(state: State<AppState>, id: String) -> Result<()> {
    with_store(&state, |s| s.delete_category(&id))
}
