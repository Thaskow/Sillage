use std::path::{Path, PathBuf};
use std::sync::PoisonError;

use serde::Serialize;
use sillage_core::claude_limits::{self as limits, Token};
use sillage_core::profiles::{
    self, account_status, AccountStatus, NewProfile, Profile, ProfilePatch, Provider,
};
use sillage_core::sharing::{self, McpCopy, Sharing};
use sillage_core::usage::{self, Limits, Usage};
use sillage_core::{Error, Result};
use tauri::State;

use crate::commands::with_store;
use crate::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInfo {
    #[serde(flatten)]
    profile: Profile,
    status: AccountStatus,
    sharing: Sharing,
    managed: bool,
}

fn managed_root(state: &AppState) -> PathBuf {
    state.data_dir.join("profiles")
}

fn is_managed(state: &AppState, profile: &Profile) -> bool {
    profiles::is_managed(&managed_root(state), profile)
}

fn info(state: &AppState, profile: Profile) -> ProfileInfo {
    let dir = PathBuf::from(&profile.config_dir);
    ProfileInfo {
        status: account_status(profile.provider, &dir),
        sharing: if profile.share_config {
            sharing::status(profile.provider, &dir)
        } else {
            Sharing::default()
        },
        managed: is_managed(state, &profile),
        profile,
    }
}

#[tauri::command]
pub async fn list_profiles(state: State<'_, AppState>) -> Result<Vec<ProfileInfo>> {
    let list = with_store(&state, |s| s.profiles())?;
    Ok(list.into_iter().map(|p| info(&state, p)).collect())
}

#[tauri::command]
pub async fn create_profile(
    state: State<'_, AppState>,
    profile: NewProfile,
) -> Result<ProfileInfo> {
    let root = managed_root(&state);
    let created = with_store(&state, |s| {
        s.create_profile(profile, |id| root.join(id).display().to_string())
    })?;
    let dir = PathBuf::from(&created.config_dir);
    std::fs::create_dir_all(&dir)?;
    if created.share_config {
        sharing::share(created.provider, &dir)?;
    }
    Ok(info(&state, created))
}

#[tauri::command]
pub async fn update_profile(
    state: State<'_, AppState>,
    id: String,
    patch: ProfilePatch,
) -> Result<ProfileInfo> {
    let toggled = patch.share_config;
    let p = with_store(&state, |s| s.update_profile(&id, patch))?;
    let dir = PathBuf::from(&p.config_dir);
    match toggled {
        Some(true) => {
            sharing::share(p.provider, &dir)?;
        }
        Some(false) => sharing::unshare(p.provider, &dir)?,
        None => {}
    }
    Ok(info(&state, p))
}

#[tauri::command]
pub async fn delete_profile(
    state: State<'_, AppState>,
    id: String,
    remove_files: bool,
) -> Result<()> {
    let p = with_store(&state, |s| s.profile(&id))?;
    let dir = PathBuf::from(&p.config_dir);
    if remove_files && !is_managed(&state, &p) {
        return Err(Error::Invalid(
            "Sillage ne supprime que les dossiers de comptes qu'il a créés".into(),
        ));
    }
    if in_use(&state, &id)? {
        return Err(Error::Invalid(
            "arrêtez les sessions qui utilisent ce compte avant de le retirer".into(),
        ));
    }
    if dir.is_dir() {
        sharing::unshare(p.provider, &dir)?;
    }
    with_store(&state, |s| s.delete_profile(&id))?;
    if remove_files && dir.is_dir() {
        std::fs::remove_dir_all(&dir)?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_session_profile(
    state: State<AppState>,
    id: String,
    profile_id: Option<String>,
) -> Result<()> {
    if state.pty.is_running(&id) {
        return Err(Error::Invalid(
            "arrêtez la session avant de changer de compte".into(),
        ));
    }
    with_store(&state, |s| {
        s.set_session_profile(&id, profile_id.as_deref())
    })?;
    crate::terminals::forget_agent_files(&state, &id);
    Ok(())
}

pub fn launch_env(state: &AppState, profile_id: Option<&str>) -> Result<Vec<(String, String)>> {
    let Some(pid) = profile_id else {
        return Ok(vec![]);
    };
    let p = with_store_ref(state, |s| s.profile(pid))?;
    std::fs::create_dir_all(&p.config_dir)?;
    if p.share_config {
        let _ = sharing::share(p.provider, Path::new(&p.config_dir));
    }
    Ok(vec![(p.provider.env_var().to_string(), p.config_dir)])
}

fn in_use(state: &AppState, profile_id: &str) -> Result<bool> {
    let sessions = with_store_ref(state, |s| s.sessions())?;
    Ok(sessions
        .iter()
        .any(|d| d.profile_id.as_deref() == Some(profile_id) && state.pty.is_running(&d.id)))
}

#[tauri::command]
pub async fn copy_mcp_servers(state: State<'_, AppState>, id: String) -> Result<McpCopy> {
    let p = with_store(&state, |s| s.profile(&id))?;
    if p.provider != Provider::Claude {
        return Err(Error::Invalid(
            "Codex lit ses serveurs MCP dans config.toml, partagé avec la configuration".into(),
        ));
    }
    if in_use(&state, &id)? {
        return Err(Error::Invalid(
            "arrêtez les sessions de ce compte : Claude Code réécrit ce fichier en quittant".into(),
        ));
    }
    let source = sharing::default_claude_json()
        .ok_or_else(|| Error::Invalid("dossier utilisateur introuvable".into()))?;
    sharing::copy_mcp_servers(&source, Path::new(&p.config_dir))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountUsage {
    profile_id: Option<String>,
    provider: Provider,
    config_dir: String,
    usage: Usage,
    limits_error: Option<String>,
}

#[tauri::command]
pub async fn usage_report(
    state: State<'_, AppState>,
    now: i64,
    day_start: i64,
) -> Result<Vec<AccountUsage>> {
    let mut targets: Vec<(Option<String>, Provider, PathBuf)> = [Provider::Claude, Provider::Codex]
        .into_iter()
        .filter_map(|p| {
            sharing::default_home(p)
                .filter(|d| d.is_dir())
                .map(|d| (None, p, d))
        })
        .collect();
    let fetch_limits = with_store_ref(&state, |s| s.settings())?.claude_limits_enabled;
    for p in with_store_ref(&state, |s| s.profiles())? {
        targets.push((Some(p.id), p.provider, PathBuf::from(p.config_dir)));
    }
    tauri::async_runtime::spawn_blocking(move || {
        targets
            .into_iter()
            .map(|(profile_id, provider, dir)| {
                let mut usage = usage::usage(provider, &dir, now, day_start);
                let mut limits_error = None;
                if provider == Provider::Claude && fetch_limits {
                    match claude_limits(&dir, now) {
                        Ok(l) => usage.limits = l,
                        Err(e) => limits_error = Some(e),
                    }
                }
                AccountUsage {
                    usage,
                    limits_error,
                    config_dir: dir.display().to_string(),
                    profile_id,
                    provider,
                }
            })
            .collect()
    })
    .await
    .map_err(|e| Error::Invalid(format!("calcul de la consommation interrompu : {e}")))
}

fn claude_limits(dir: &Path, now: i64) -> std::result::Result<Option<Limits>, String> {
    let token = match limits::read_token(dir, now) {
        Token::Valid(t) => t,
        Token::Missing => return Err("compte non connecté".into()),
        Token::Expired => {
            return Err(
                "connexion expirée : ouvrez Claude Code avec ce compte pour la renouveler".into(),
            )
        }
    };
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(10))
        .build();
    let res = agent
        .get(limits::USAGE_URL)
        .set("Authorization", &format!("Bearer {token}"))
        .set("anthropic-beta", "oauth-2025-04-20")
        .set("User-Agent", "Sillage")
        .call();
    match res {
        Ok(r) => r
            .into_json::<serde_json::Value>()
            .map(|v| limits::parse_limits(&v, now))
            .map_err(|_| "réponse d'Anthropic illisible".into()),
        Err(ureq::Error::Status(401 | 403, _)) => {
            Err("connexion refusée : ouvrez Claude Code avec ce compte pour la renouveler".into())
        }
        Err(ureq::Error::Status(429, _)) => {
            Err("trop de relevés, réessayez dans quelques minutes".into())
        }
        Err(ureq::Error::Status(code, _)) => Err(format!("Anthropic a répondu {code}")),
        Err(ureq::Error::Transport(_)) => Err("api.anthropic.com injoignable".into()),
    }
}

fn with_store_ref<T>(
    state: &AppState,
    f: impl FnOnce(&sillage_core::Store) -> Result<T>,
) -> Result<T> {
    f(&state.store.lock().unwrap_or_else(PoisonError::into_inner))
}
