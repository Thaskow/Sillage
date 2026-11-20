use std::path::PathBuf;

use sillage_core::git::{self, ChangesReport, FileDiff};
use sillage_core::{Error, Result};
use tauri::State;

use crate::commands::with_store;
use crate::AppState;

fn env_dir(var: &str, rest: &[&str]) -> Option<PathBuf> {
    let mut p = PathBuf::from(std::env::var_os(var)?);
    p.extend(rest);
    Some(p)
}

fn find_git() -> Option<PathBuf> {
    let extra: Vec<PathBuf> = [
        env_dir("ProgramFiles", &["Git", "cmd"]),
        env_dir("LOCALAPPDATA", &["Programs", "Git", "cmd"]),
        env_dir("USERPROFILE", &["scoop", "shims"]),
        Some(PathBuf::from("/opt/homebrew/bin")),
        Some(PathBuf::from("/usr/bin")),
    ]
    .into_iter()
    .flatten()
    .collect();
    git::find_git(std::env::var("PATH").ok().as_deref(), &extra)
}

fn session_cwd(state: &State<'_, AppState>, id: &str) -> Result<PathBuf> {
    let def = with_store(state, |s| s.session(id))?;
    def.cwd
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .ok_or_else(|| Error::NotFound("dossier de travail".into()))
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| Error::Invalid(e.to_string()))?
}

#[tauri::command]
pub async fn session_changes(state: State<'_, AppState>, id: String) -> Result<ChangesReport> {
    let cwd = session_cwd(&state, &id)?;
    blocking(move || git::changes(find_git().as_deref(), &cwd)).await
}

#[tauri::command]
pub async fn session_diff(
    state: State<'_, AppState>,
    id: String,
    path: String,
) -> Result<FileDiff> {
    let cwd = session_cwd(&state, &id)?;
    blocking(move || {
        let g = find_git().ok_or_else(|| Error::NotFound("git".into()))?;
        git::diff(&g, &cwd, &path)
    })
    .await
}
