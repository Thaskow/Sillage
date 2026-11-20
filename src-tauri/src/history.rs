use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use sillage_core::history::{HistoryEntry, IndexStats, Root};
use sillage_core::profiles::Provider;
use sillage_core::sessions::{NewSession, SessionDef};
use sillage_core::{sharing, Error, Result, Store};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::with_store;
use crate::AppState;

static INDEXING: AtomicBool = AtomicBool::new(false);

fn same_dir(a: &Path, b: &Path) -> bool {
    let n = |p: &Path| {
        p.display()
            .to_string()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_lowercase()
    };
    n(a) == n(b)
}

fn roots(state: &AppState) -> Result<Vec<Root>> {
    let mut roots: Vec<Root> = [Provider::Claude, Provider::Codex]
        .into_iter()
        .filter_map(|p| sharing::default_home(p).map(|dir| Root { provider: p, dir }))
        .collect();
    let profiles = state
        .store
        .lock()
        .map_err(|_| Error::Invalid("accès concurrent à la base interrompu".into()))?
        .profiles()?;
    for p in profiles {
        let dir = PathBuf::from(p.config_dir);
        if !roots
            .iter()
            .any(|r| r.provider == p.provider && same_dir(&r.dir, &dir))
        {
            roots.push(Root {
                provider: p.provider,
                dir,
            });
        }
    }
    roots.retain(|r| r.dir.is_dir());
    Ok(roots)
}

pub fn spawn_index(app: AppHandle) -> bool {
    if INDEXING.swap(true, Ordering::SeqCst) {
        return false;
    }
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let result = roots(&state).and_then(|roots| {
            let mut store = Store::open_secondary(&state.data_dir.join("sillage.db"))?;
            store.index_history(&roots)
        });
        INDEXING.store(false, Ordering::SeqCst);
        let _ = app.emit(
            "history-indexed",
            result.map_err(|e| e.to_string()).unwrap_or_else(|e| {
                eprintln!("indexation de l'historique : {e}");
                IndexStats::default()
            }),
        );
    });
    true
}

#[tauri::command]
pub fn history_refresh(app: AppHandle) -> bool {
    spawn_index(app)
}

#[tauri::command]
pub fn history_indexing() -> bool {
    INDEXING.load(Ordering::SeqCst)
}

#[tauri::command]
pub async fn history_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<HistoryEntry>> {
    with_store(&state, |s| s.history(&query, limit.unwrap_or(300)))
}

#[tauri::command]
pub fn history_resume(state: State<AppState>, id: i64, group_id: String) -> Result<SessionDef> {
    with_store(&state, |s| {
        let e = s.history_entry(id)?;
        let cwd = e
            .cwd
            .clone()
            .filter(|c| Path::new(c).is_dir())
            .ok_or_else(|| Error::NotFound("dossier de la conversation".into()))?;
        let source = PathBuf::from(&e.source_dir);
        let profile_id = s
            .profiles()?
            .into_iter()
            .find(|p| p.provider == e.tool && same_dir(Path::new(&p.config_dir), &source))
            .map(|p| p.id);
        let title: String = e.title.chars().take(60).collect();
        let def = s.create_session(NewSession {
            group_id,
            kind: Some(e.tool.kind()),
            title: Some(title),
            profile_id,
            cwd: Some(cwd),
            command: None,
            args: vec![],
        })?;
        s.set_agent_session(&def.id, Some(&e.session_id), e.started_at)?;
        s.session(&def.id)
    })
}
