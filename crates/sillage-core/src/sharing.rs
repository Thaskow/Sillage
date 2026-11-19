use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::profiles::Provider;
use crate::{now_ms, Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Item {
    File,
    Dir,
}

fn items(provider: Provider) -> &'static [(&'static str, Item)] {
    match provider {
        Provider::Claude => &[
            ("CLAUDE.md", Item::File),
            ("settings.json", Item::File),
            ("keybindings.json", Item::File),
            ("agents", Item::Dir),
            ("commands", Item::Dir),
            ("skills", Item::Dir),
            ("plugins", Item::Dir),
            ("output-styles", Item::Dir),
        ],
        Provider::Codex => &[
            ("config.toml", Item::File),
            ("AGENTS.md", Item::File),
            ("prompts", Item::Dir),
            ("skills", Item::Dir),
            ("rules", Item::Dir),
        ],
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Sharing {
    pub source: Option<String>,
    pub shared: Vec<String>,
    pub failed: Vec<String>,
}

fn user_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

pub fn default_home(provider: Provider) -> Option<PathBuf> {
    if let Some(v) = std::env::var_os(provider.env_var()).filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(v));
    }
    let dir = match provider {
        Provider::Claude => ".claude",
        Provider::Codex => ".codex",
    };
    user_home().map(|h| h.join(dir))
}

pub fn default_claude_json() -> Option<PathBuf> {
    if let Some(v) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(v).join(".claude.json"));
    }
    user_home().map(|h| h.join(".claude.json"))
}

fn same(a: &Path, b: &Path) -> bool {
    same_file::is_same_file(a, b).unwrap_or(false)
}

fn present(path: &Path, item: Item) -> bool {
    match item {
        Item::File => path.is_file(),
        Item::Dir => path.is_dir(),
    }
}

fn is_link(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

fn remove_link(path: &Path) -> io::Result<()> {
    fs::remove_dir(path).or_else(|_| fs::remove_file(path))
}

#[cfg(windows)]
fn link_dir(src: &Path, dst: &Path) -> io::Result<()> {
    junction::create(src, dst)
}

#[cfg(not(windows))]
fn link_dir(src: &Path, dst: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(src, dst)
}

fn backup(path: &Path) -> io::Result<()> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    fs::rename(
        path,
        path.with_file_name(format!("{name}.avant-partage-{}", now_ms())),
    )
}

fn ensure(src: &Path, dst: &Path, item: Item) -> io::Result<()> {
    if same(src, dst) {
        return Ok(());
    }
    if is_link(dst) {
        remove_link(dst)?;
    } else if dst.exists() {
        backup(dst)?;
    }
    match item {
        Item::File => fs::hard_link(src, dst),
        Item::Dir => link_dir(src, dst),
    }
}

fn source_for(provider: Provider, dir: &Path) -> Option<PathBuf> {
    let src = default_home(provider)?;
    if !src.is_dir() || same(&src, dir) {
        return None;
    }
    Some(src)
}

pub fn status(provider: Provider, dir: &Path) -> Sharing {
    let Some(src) = source_for(provider, dir) else {
        return Sharing::default();
    };
    let shared = items(provider)
        .iter()
        .filter(|(n, i)| present(&src.join(n), *i) && same(&src.join(n), &dir.join(n)))
        .map(|(n, _)| n.to_string())
        .collect();
    Sharing {
        source: Some(src.display().to_string()),
        shared,
        failed: vec![],
    }
}

pub fn share(provider: Provider, dir: &Path) -> Result<Sharing> {
    let Some(src) = source_for(provider, dir) else {
        return Ok(Sharing::default());
    };
    fs::create_dir_all(dir)?;
    let mut out = Sharing {
        source: Some(src.display().to_string()),
        ..Default::default()
    };
    for (name, item) in items(provider) {
        let from = src.join(name);
        if !present(&from, *item) {
            continue;
        }
        match ensure(&from, &dir.join(name), *item) {
            Ok(()) => out.shared.push(name.to_string()),
            Err(_) => out.failed.push(name.to_string()),
        }
    }
    Ok(out)
}

pub fn unshare(provider: Provider, dir: &Path) -> Result<()> {
    let src = default_home(provider);
    for (name, item) in items(provider) {
        let dst = dir.join(name);
        if is_link(&dst) {
            remove_link(&dst)?;
        } else if *item == Item::File
            && src
                .as_ref()
                .is_some_and(|s| dst.is_file() && same(&s.join(name), &dst))
        {
            fs::remove_file(&dst)?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpCopy {
    pub added: Vec<String>,
    pub skipped: Vec<String>,
}

pub fn copy_mcp_servers(source: &Path, dir: &Path) -> Result<McpCopy> {
    let read = |p: &Path| -> Result<serde_json::Value> {
        Ok(serde_json::from_str(&fs::read_to_string(p)?)?)
    };
    let servers = match read(source) {
        Ok(v) => v.get("mcpServers").cloned().unwrap_or_default(),
        Err(Error::Io(e)) if e.kind() == io::ErrorKind::NotFound => serde_json::Value::Null,
        Err(e) => return Err(e),
    };
    let Some(servers) = servers.as_object().filter(|m| !m.is_empty()) else {
        return Ok(McpCopy::default());
    };
    let target = dir.join(".claude.json");
    let existed = target.is_file();
    let mut doc = if existed {
        read(&target)?
    } else {
        serde_json::json!({})
    };
    let root = doc
        .as_object_mut()
        .ok_or_else(|| Error::Invalid(".claude.json du compte illisible".into()))?;
    let dest = root
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| Error::Invalid("mcpServers du compte illisible".into()))?;
    let mut out = McpCopy::default();
    for (name, conf) in servers {
        if dest.contains_key(name) {
            out.skipped.push(name.clone());
        } else {
            dest.insert(name.clone(), conf.clone());
            out.added.push(name.clone());
        }
    }
    if out.added.is_empty() {
        return Ok(out);
    }
    fs::create_dir_all(dir)?;
    if existed {
        fs::copy(
            &target,
            dir.join(format!(".claude.json.avant-mcp-{}", now_ms())),
        )?;
    }
    let tmp = dir.join(".claude.json.sillage-tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(&doc)?)?;
    fs::rename(&tmp, &target)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_home<T>(home: &Path, f: impl FnOnce() -> T) -> T {
        std::env::set_var("CLAUDE_CONFIG_DIR", home);
        let r = f();
        std::env::remove_var("CLAUDE_CONFIG_DIR");
        r
    }

    #[test]
    fn shares_links_and_unshares_without_touching_source() {
        let d = tempfile::tempdir().unwrap();
        let home = d.path().join("home");
        let acc = d.path().join("acc");
        fs::create_dir_all(home.join("skills/s1")).unwrap();
        fs::write(home.join("skills/s1/SKILL.md"), "x").unwrap();
        fs::write(home.join("CLAUDE.md"), "rules").unwrap();
        fs::create_dir_all(&acc).unwrap();
        fs::write(acc.join("CLAUDE.md"), "old").unwrap();
        with_home(&home, || {
            let s = share(Provider::Claude, &acc).unwrap();
            assert_eq!(s.shared, vec!["CLAUDE.md", "skills"]);
            assert!(s.failed.is_empty());
            assert_eq!(fs::read_to_string(acc.join("CLAUDE.md")).unwrap(), "rules");
            assert!(acc.join("skills/s1/SKILL.md").is_file());
            let backups = fs::read_dir(&acc)
                .unwrap()
                .filter(|e| {
                    e.as_ref()
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .starts_with("CLAUDE.md.avant-partage-")
                })
                .count();
            assert_eq!(backups, 1);
            fs::write(acc.join("CLAUDE.md"), "edited").unwrap();
            assert_eq!(
                fs::read_to_string(home.join("CLAUDE.md")).unwrap(),
                "edited"
            );
            assert_eq!(status(Provider::Claude, &acc).shared.len(), 2);
            assert_eq!(share(Provider::Claude, &acc).unwrap().shared.len(), 2);
            unshare(Provider::Claude, &acc).unwrap();
            assert!(!acc.join("CLAUDE.md").exists() && !acc.join("skills").exists());
            assert!(home.join("skills/s1/SKILL.md").is_file());
            assert_eq!(
                fs::read_to_string(home.join("CLAUDE.md")).unwrap(),
                "edited"
            );
            assert!(share(Provider::Claude, &home).unwrap().shared.is_empty());
        });
    }

    #[test]
    fn copies_only_missing_mcp_servers() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("src.json");
        let acc = d.path().join("acc");
        fs::write(
            &src,
            r#"{"mcpServers":{"a":{"command":"x"},"b":{"command":"y"}}}"#,
        )
        .unwrap();
        fs::create_dir_all(&acc).unwrap();
        fs::write(
            acc.join(".claude.json"),
            r#"{"oauthAccount":{"emailAddress":"e"},"mcpServers":{"b":{"command":"mine"}}}"#,
        )
        .unwrap();
        let r = copy_mcp_servers(&src, &acc).unwrap();
        assert_eq!(r.added, vec!["a"]);
        assert_eq!(r.skipped, vec!["b"]);
        let v: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(acc.join(".claude.json")).unwrap()).unwrap();
        assert_eq!(v["oauthAccount"]["emailAddress"], "e");
        assert_eq!(v["mcpServers"]["b"]["command"], "mine");
        assert_eq!(v["mcpServers"]["a"]["command"], "x");
        assert!(copy_mcp_servers(&d.path().join("none.json"), &acc)
            .unwrap()
            .added
            .is_empty());
    }
}
