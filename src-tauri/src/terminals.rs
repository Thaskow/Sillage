use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::Ordering;

use serde::Serialize;
use sillage_core::profiles::Provider;
use sillage_core::resume::{self, Saved};
use sillage_core::sessions::{find_program, launch_program, NewSession, SessionDef, SessionKind};
use sillage_core::sharing;
use sillage_core::{Error, Result};
use sillage_pty::{LaunchSpec, PtyManager, RunningInfo};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::with_store;
use crate::AppState;

fn pty_err(e: sillage_pty::PtyError) -> Error {
    Error::Invalid(e.to_string())
}

fn env_dir(var: &str, rest: &[&str]) -> Option<PathBuf> {
    let mut p = PathBuf::from(std::env::var_os(var)?);
    for r in rest {
        p.push(r);
    }
    Some(p)
}

fn extra_dirs() -> Vec<PathBuf> {
    [
        env_dir("USERPROFILE", &[".local", "bin"]),
        env_dir("APPDATA", &["npm"]),
        env_dir("LOCALAPPDATA", &["Programs", "claude"]),
        env_dir("ProgramFiles", &["PowerShell", "7"]),
        env_dir("SystemRoot", &["System32", "WindowsPowerShell", "v1.0"]),
        env_dir("SystemRoot", &["System32"]),
        env_dir("HOME", &[".local", "bin"]),
        env_dir("HOME", &[".npm-global", "bin"]),
        Some(PathBuf::from("/opt/homebrew/bin")),
        Some(PathBuf::from("/usr/local/bin")),
    ]
    .into_iter()
    .flatten()
    .collect()
}

fn resolve(kind: SessionKind) -> Option<PathBuf> {
    find_program(kind, std::env::var("PATH").ok().as_deref(), &extra_dirs())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindInfo {
    kind: SessionKind,
    label: &'static str,
    agent: bool,
    path: Option<String>,
}

#[tauri::command]
pub fn available_kinds() -> Vec<KindInfo> {
    SessionKind::ALL
        .into_iter()
        .filter(|k| *k != SessionKind::Custom)
        .map(|k| KindInfo {
            kind: k,
            label: k.default_title(),
            agent: k.is_agent(),
            path: resolve(k).map(|p| p.display().to_string()),
        })
        .collect()
}

#[tauri::command]
pub fn list_sessions(state: State<AppState>) -> Result<Vec<SessionDef>> {
    with_store(&state, |s| s.sessions())
}

#[tauri::command]
pub fn create_session(state: State<AppState>, session: NewSession) -> Result<SessionDef> {
    with_store(&state, |s| s.create_session(session))
}

#[tauri::command]
pub fn rename_session(state: State<AppState>, id: String, title: String) -> Result<SessionDef> {
    with_store(&state, |s| s.rename_session(&id, &title))
}

#[tauri::command]
pub fn move_session(state: State<AppState>, id: String, group_id: String) -> Result<SessionDef> {
    with_store(&state, |s| s.move_session(&id, &group_id))
}

#[tauri::command]
pub fn delete_session(state: State<AppState>, id: String) -> Result<()> {
    if state.pty.is_running(&id) {
        state.pty.kill(&id).map_err(pty_err)?;
    }
    with_store(&state, |s| s.delete_session(&id))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitEvent {
    id: String,
    code: Option<u32>,
    killed: bool,
}

#[tauri::command]
pub fn start_session(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    cols: u16,
    rows: u16,
    output: Channel<InvokeResponseBody>,
) -> Result<RunningInfo> {
    let def = with_store(&state, |s| s.session(&id))?;
    let (program, args) = match def.kind {
        SessionKind::Custom => {
            let cmd = def.command.clone().unwrap_or_default();
            (PathBuf::from(cmd.trim()), def.args.clone())
        }
        kind => {
            let found = resolve(kind).ok_or_else(|| {
                Error::Invalid(format!(
                    "{} est introuvable sur cette machine",
                    kind.default_title()
                ))
            })?;
            let mut args = kind.default_args();
            args.extend(def.args.clone());
            launch_program(&found, args)
        }
    };
    let cwd = def
        .cwd
        .clone()
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from));
    let mut args = args;
    let agent = agent_launch(&state, &def, cwd.as_ref())?;
    if let Some(a) = &agent {
        args.extend(a.args.iter().cloned());
    }
    let spec = LaunchSpec {
        program,
        args,
        cwd,
        env: crate::accounts::launch_env(&state, def.profile_id.as_deref())?,
        cols,
        rows,
    };

    let exit_id = id.clone();
    let info = state
        .pty
        .spawn(
            &id,
            spec,
            Box::new(move |bytes| {
                let _ = output.send(InvokeResponseBody::Raw(bytes.to_vec()));
            }),
            Box::new(move |e| {
                let st = app.state::<AppState>();
                if !st.exiting.load(Ordering::SeqCst) {
                    let _ = with_store(&st, |s| s.set_resume(&exit_id, false));
                }
                let _ = app.emit(
                    "session-exit",
                    ExitEvent {
                        id: exit_id,
                        code: e.code,
                        killed: e.killed,
                    },
                );
            }),
        )
        .map_err(pty_err)?;
    let _ = with_store(&state, |s| {
        s.touch_session(&id)?;
        s.set_resume(&id, true)?;
        match &agent {
            Some(a) => s.set_agent_session(&id, a.session_id.as_deref(), a.started_at),
            None => Ok(()),
        }
    });
    Ok(info)
}

fn agent_launch(
    state: &State<AppState>,
    def: &SessionDef,
    cwd: Option<&PathBuf>,
) -> Result<Option<resume::AgentLaunch>> {
    let Some(provider) = Provider::of_kind(def.kind) else {
        return Ok(None);
    };
    let home = match &def.profile_id {
        Some(pid) => Some(PathBuf::from(
            with_store(state, |s| s.profile(pid))?.config_dir,
        )),
        None => sharing::default_home(provider),
    };
    let taken: HashSet<String> = with_store(state, |s| s.sessions())?
        .into_iter()
        .filter(|d| d.id != def.id)
        .filter_map(|d| d.agent_session_id)
        .collect();
    let cwd = cwd.map(|c| c.display().to_string()).unwrap_or_default();
    Ok(resume::plan(
        def.kind,
        Saved {
            session_id: def.agent_session_id.as_deref(),
            started_at: def.agent_started_at,
        },
        home.as_deref(),
        &cwd,
        &taken,
        sillage_core::now_ms(),
    ))
}

#[tauri::command]
pub fn reset_agent_session(state: State<AppState>, id: String) -> Result<()> {
    if state.pty.is_running(&id) {
        return Err(Error::Invalid(
            "arrêtez la session avant de repartir d'une nouvelle conversation".into(),
        ));
    }
    with_store(&state, |s| s.set_agent_session(&id, None, None))
}

#[tauri::command]
pub fn write_session(state: State<AppState>, id: String, data: String) -> Result<()> {
    state.pty.write(&id, data.as_bytes()).map_err(pty_err)
}

#[tauri::command]
pub fn resize_session(state: State<AppState>, id: String, cols: u16, rows: u16) -> Result<()> {
    state.pty.resize(&id, cols, rows).map_err(pty_err)
}

#[tauri::command]
pub fn kill_session(state: State<AppState>, id: String) -> Result<()> {
    state.pty.kill(&id).map_err(pty_err)
}

#[tauri::command]
pub fn running_sessions(state: State<AppState>) -> Vec<RunningInfo> {
    state.pty.running()
}

pub fn shutdown(pty: &PtyManager) {
    pty.kill_all();
}
