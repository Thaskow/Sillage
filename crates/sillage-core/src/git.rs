use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::{Error, Result};

pub const MAX_STATUS_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_FILES: usize = 2000;
pub const MAX_DIFF_BYTES: usize = 512 * 1024;
const TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub orig_path: Option<String>,
    pub kind: ChangeKind,
    pub staged: bool,
    pub unstaged: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Status {
    pub branch: Option<String>,
    pub files: Vec<FileChange>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ChangesReport {
    #[serde(rename_all = "camelCase")]
    Ok {
        root: String,
        branch: Option<String>,
        files: Vec<FileChange>,
        truncated: bool,
    },
    #[serde(rename_all = "camelCase")]
    NotRepo { cwd: String },
    #[serde(rename_all = "camelCase")]
    NoGit,
    #[serde(rename_all = "camelCase")]
    NoCwd { cwd: String },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub text: String,
    pub truncated: bool,
    pub binary: bool,
}

fn kind_of(x: u8, y: u8) -> ChangeKind {
    match (x, y) {
        (b'?', _) => ChangeKind::Untracked,
        (b'U', _) | (_, b'U') | (b'A', b'A') | (b'D', b'D') => ChangeKind::Conflicted,
        (b'R', _) | (_, b'R') => ChangeKind::Renamed,
        (b'C', _) | (_, b'C') => ChangeKind::Copied,
        (b'A', _) => ChangeKind::Added,
        (b'D', _) | (_, b'D') => ChangeKind::Deleted,
        (b'T', _) | (_, b'T') => ChangeKind::TypeChanged,
        _ => ChangeKind::Modified,
    }
}

fn parse_branch(line: &str) -> Option<String> {
    let head = line.split("...").next()?.trim();
    let head = head.strip_prefix("No commits yet on ").unwrap_or(head);
    let head = head.strip_prefix("Initial commit on ").unwrap_or(head);
    if head.is_empty() || head.starts_with("HEAD (no branch)") {
        return None;
    }
    Some(head.to_string())
}

pub fn parse_porcelain(raw: &[u8]) -> Status {
    let mut out = Status::default();
    let mut parts = raw.split(|b| *b == 0).filter(|p| !p.is_empty());
    while let Some(entry) = parts.next() {
        if let Some(rest) = entry.strip_prefix(b"## ") {
            out.branch = parse_branch(&String::from_utf8_lossy(rest));
            continue;
        }
        if entry.len() < 4 || entry[2] != b' ' {
            continue;
        }
        let (x, y) = (entry[0], entry[1]);
        if x == b'!' {
            continue;
        }
        let path = String::from_utf8_lossy(&entry[3..]).into_owned();
        let orig_path = if matches!(x, b'R' | b'C') || matches!(y, b'R' | b'C') {
            parts
                .next()
                .map(|p| String::from_utf8_lossy(p).into_owned())
        } else {
            None
        };
        let untracked = x == b'?';
        out.files.push(FileChange {
            path,
            orig_path,
            kind: kind_of(x, y),
            staged: !untracked && x != b' ',
            unstaged: untracked || y != b' ',
        });
    }
    out
}

pub fn truncate_text(raw: &[u8], max: usize) -> (String, bool) {
    if raw.len() <= max {
        return (String::from_utf8_lossy(raw).into_owned(), false);
    }
    let cut = raw[..max]
        .iter()
        .rposition(|b| *b == b'\n')
        .map(|i| i + 1)
        .unwrap_or(max);
    (String::from_utf8_lossy(&raw[..cut]).into_owned(), true)
}

pub fn is_binary_diff(text: &str) -> bool {
    text.lines().any(|l| {
        (l.starts_with("Binary files ") && l.ends_with(" differ")) || l == "GIT binary patch"
    })
}

pub fn validate_rel_path(p: &str) -> Result<()> {
    let bad = || Error::Invalid(format!("chemin refusé : {p}"));
    if p.is_empty() || p.contains('\0') || p.contains(':') {
        return Err(bad());
    }
    let path = Path::new(p);
    if path.is_absolute() || p.starts_with('/') || p.starts_with('\\') {
        return Err(bad());
    }
    if path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(bad());
    }
    Ok(())
}

pub fn find_git(path_var: Option<&str>, extra_dirs: &[PathBuf]) -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) {
        &["git.exe"]
    } else {
        &["git"]
    };
    let dirs: Vec<PathBuf> = path_var
        .map(|p| std::env::split_paths(p).collect())
        .unwrap_or_default();
    for dir in dirs.iter().chain(extra_dirs) {
        if !dir.is_absolute() {
            continue;
        }
        for n in names {
            let p = dir.join(n);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

pub struct GitOutput {
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub truncated: bool,
    pub stderr: String,
}

pub fn run_git(git: &Path, cwd: &Path, args: &[&str], max: usize) -> Result<GitOutput> {
    let mut cmd = Command::new(git);
    cmd.current_dir(cwd)
        .args(["--no-pager", "--literal-pathspecs", "--no-optional-locks"])
        .args(["-c", "core.quotepath=off", "-c", "color.ui=false"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn()?;
    let mut stdout = child.stdout.take().expect("stdout");
    let mut stderr = child.stderr.take().expect("stderr");
    let out_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = (&mut stdout).take(max as u64 + 1).read_to_end(&mut buf);
        let _ = std::io::copy(&mut stdout, &mut std::io::sink());
        buf
    });
    let err_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = (&mut stderr).take(64 * 1024).read_to_end(&mut buf);
        let _ = std::io::copy(&mut stderr, &mut std::io::sink());
        buf
    });
    let deadline = Instant::now() + TIMEOUT;
    let status = loop {
        if let Some(s) = child.try_wait()? {
            break s;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Error::Invalid("git ne répond pas".into()));
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let mut stdout = out_reader.join().unwrap_or_default();
    let stderr = err_reader.join().unwrap_or_default();
    let truncated = stdout.len() > max;
    stdout.truncate(max);
    Ok(GitOutput {
        code: status.code(),
        stdout,
        truncated,
        stderr: String::from_utf8_lossy(&stderr).trim().to_string(),
    })
}

fn git_failed(o: &GitOutput) -> Error {
    Error::Invalid(if o.stderr.is_empty() {
        "git a échoué".into()
    } else {
        format!("git : {}", o.stderr.lines().next().unwrap_or_default())
    })
}

fn toplevel(git: &Path, cwd: &Path) -> Result<Option<PathBuf>> {
    let o = run_git(git, cwd, &["rev-parse", "--show-toplevel"], 64 * 1024)?;
    if o.code != Some(0) {
        return Ok(None);
    }
    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
    Ok((!s.is_empty()).then(|| PathBuf::from(s)))
}

fn read_status(git: &Path, root: &Path) -> Result<(Status, bool)> {
    let o = run_git(
        git,
        root,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--branch",
            "--untracked-files=all",
        ],
        MAX_STATUS_BYTES,
    )?;
    if o.code != Some(0) {
        return Err(git_failed(&o));
    }
    let raw = if o.truncated {
        let end = o.stdout.iter().rposition(|b| *b == 0).unwrap_or(0);
        &o.stdout[..end]
    } else {
        &o.stdout[..]
    };
    let mut st = parse_porcelain(raw);
    let mut truncated = o.truncated;
    if st.files.len() > MAX_FILES {
        st.files.truncate(MAX_FILES);
        truncated = true;
    }
    Ok((st, truncated))
}

pub fn changes(git: Option<&Path>, cwd: &Path) -> Result<ChangesReport> {
    let shown = cwd.display().to_string();
    if !cwd.is_absolute() || !cwd.is_dir() {
        return Ok(ChangesReport::NoCwd { cwd: shown });
    }
    let Some(git) = git else {
        return Ok(ChangesReport::NoGit);
    };
    let Some(root) = toplevel(git, cwd)? else {
        return Ok(ChangesReport::NotRepo { cwd: shown });
    };
    let (st, truncated) = read_status(git, &root)?;
    Ok(ChangesReport::Ok {
        root: root.display().to_string(),
        branch: st.branch,
        files: st.files,
        truncated,
    })
}

fn has_head(git: &Path, root: &Path) -> Result<bool> {
    let o = run_git(git, root, &["rev-parse", "--verify", "-q", "HEAD"], 1024)?;
    Ok(o.code == Some(0))
}

pub fn diff(git: &Path, cwd: &Path, path: &str) -> Result<FileDiff> {
    validate_rel_path(path)?;
    if !cwd.is_absolute() || !cwd.is_dir() {
        return Err(Error::NotFound("dossier de travail".into()));
    }
    let root = toplevel(git, cwd)?
        .ok_or_else(|| Error::Invalid("le dossier n'est pas un dépôt git".into()))?;
    let (st, _) = read_status(git, &root)?;
    let file = st
        .files
        .into_iter()
        .find(|f| f.path == path)
        .ok_or_else(|| Error::NotFound(format!("modification de {path}")))?;
    let base = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "-M"];
    let mut paths = vec!["--", file.path.as_str()];
    if let Some(orig) = &file.orig_path {
        paths.push(orig.as_str());
    }
    let runs: Vec<(Vec<&str>, &[i32])> = if file.kind == ChangeKind::Untracked {
        vec![(
            [
                &base[..],
                &["--no-index", "--", "/dev/null", file.path.as_str()],
            ]
            .concat(),
            &[0, 1],
        )]
    } else if has_head(git, &root)? {
        vec![([&base[..], &["HEAD"], &paths[..]].concat(), &[0])]
    } else {
        vec![
            ([&base[..], &["--cached"], &paths[..]].concat(), &[0]),
            ([&base[..], &paths[..]].concat(), &[0]),
        ]
    };
    let mut raw = Vec::new();
    let mut truncated = false;
    for (args, ok) in runs {
        if truncated {
            break;
        }
        let o = run_git(git, &root, &args, MAX_DIFF_BYTES.saturating_sub(raw.len()))?;
        if !o.code.is_some_and(|c| ok.contains(&c)) {
            return Err(git_failed(&o));
        }
        truncated |= o.truncated;
        raw.extend_from_slice(&o.stdout);
    }
    let (text, cut) = truncate_text(&raw, MAX_DIFF_BYTES);
    Ok(FileDiff {
        path: file.path,
        binary: is_binary_diff(&text),
        text,
        truncated: truncated || cut,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_and_entries() {
        let raw = b"## main...origin/main [ahead 1]\0 M src/a.rs\0A  new.txt\0?? notes/x y.md\0 D gone.rs\0";
        let st = parse_porcelain(raw);
        assert_eq!(st.branch.as_deref(), Some("main"));
        let kinds: Vec<_> = st.files.iter().map(|f| (f.path.as_str(), f.kind)).collect();
        assert_eq!(
            kinds,
            vec![
                ("src/a.rs", ChangeKind::Modified),
                ("new.txt", ChangeKind::Added),
                ("notes/x y.md", ChangeKind::Untracked),
                ("gone.rs", ChangeKind::Deleted),
            ]
        );
        assert!(!st.files[0].staged && st.files[0].unstaged);
        assert!(st.files[1].staged && !st.files[1].unstaged);
        assert!(!st.files[2].staged && st.files[2].unstaged);
    }

    #[test]
    fn parses_renames_with_original_path() {
        let raw = b"R  new name.rs\0old name.rs\0MM both.rs\0";
        let st = parse_porcelain(raw);
        assert_eq!(st.branch, None);
        assert_eq!(st.files[0].path, "new name.rs");
        assert_eq!(st.files[0].orig_path.as_deref(), Some("old name.rs"));
        assert_eq!(st.files[0].kind, ChangeKind::Renamed);
        assert_eq!(st.files[1].path, "both.rs");
        assert!(st.files[1].staged && st.files[1].unstaged);
    }

    #[test]
    fn parses_conflicts_unborn_branch_and_ignores_garbage() {
        let raw = "## No commits yet on dév\0UU c.rs\0AA d.rs\0!! ignored\0x\0 T link\0".as_bytes();
        let st = parse_porcelain(raw);
        assert_eq!(st.branch.as_deref(), Some("dév"));
        let kinds: Vec<_> = st.files.iter().map(|f| f.kind).collect();
        assert_eq!(
            kinds,
            vec![
                ChangeKind::Conflicted,
                ChangeKind::Conflicted,
                ChangeKind::TypeChanged
            ]
        );
        assert_eq!(parse_porcelain(b"## HEAD (no branch)\0").branch, None);
    }

    #[test]
    fn truncates_on_line_boundary() {
        assert_eq!(truncate_text(b"abc", 10), ("abc".into(), false));
        assert_eq!(
            truncate_text(b"one\ntwo\nthree", 9),
            ("one\ntwo\n".into(), true)
        );
        assert_eq!(truncate_text(b"abcdef", 3), ("abc".into(), true));
    }

    #[test]
    fn detects_binary() {
        assert!(is_binary_diff(
            "diff --git a/x b/x\nBinary files a/x and b/x differ\n"
        ));
        assert!(!is_binary_diff(
            "diff --git a/x b/x\n+Binary files are fun\n"
        ));
    }

    #[test]
    fn validates_relative_paths() {
        for ok in ["a.rs", "src/a b.rs", "dir\\file.txt", ".github/x.yml"] {
            assert!(validate_rel_path(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "../x",
            "a/../../x",
            "/etc/passwd",
            "\\\\server\\share",
            "C:\\x",
            "C:x",
            "./a",
            "a\0b",
        ] {
            assert!(validate_rel_path(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn missing_dir_and_missing_git_are_reported() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope");
        assert!(matches!(
            changes(None, &missing).unwrap(),
            ChangesReport::NoCwd { .. }
        ));
        assert_eq!(changes(None, dir.path()).unwrap(), ChangesReport::NoGit);
    }

    fn system_git() -> Option<PathBuf> {
        find_git(std::env::var("PATH").ok().as_deref(), &[])
    }

    fn git(g: &Path, dir: &Path, args: &[&str]) {
        let o = run_git(g, dir, args, 1 << 20).unwrap();
        assert_eq!(o.code, Some(0), "{args:?}: {}", o.stderr);
    }

    #[test]
    fn real_repository_status_and_diff() {
        let Some(g) = system_git() else { return };
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert!(matches!(
            changes(Some(&g), root).unwrap(),
            ChangesReport::NotRepo { .. }
        ));
        git(&g, root, &["init", "-q", "-b", "main"]);
        git(&g, root, &["config", "user.email", "t@example.invalid"]);
        git(&g, root, &["config", "user.name", "t"]);
        std::fs::write(root.join("a.txt"), "one\ntwo\n").unwrap();
        git(&g, root, &["add", "a.txt"]);
        let unborn = diff(&g, root, "a.txt").unwrap();
        assert!(unborn.text.contains("+two"));
        git(&g, root, &["commit", "-q", "-m", "init"]);
        std::fs::write(root.join("a.txt"), "one\n2\n").unwrap();
        std::fs::create_dir(root.join("sub")).unwrap();
        std::fs::write(root.join("sub").join("new [x].txt"), "hello\n").unwrap();

        let ChangesReport::Ok {
            branch,
            files,
            truncated,
            ..
        } = changes(Some(&g), &root.join("sub")).unwrap()
        else {
            panic!("dépôt attendu")
        };
        assert_eq!(branch.as_deref(), Some("main"));
        assert!(!truncated);
        assert_eq!(files.len(), 2);
        let d = diff(&g, &root.join("sub"), "a.txt").unwrap();
        assert!(d.text.contains("-two") && d.text.contains("+2"));
        assert!(!d.binary && !d.truncated);
        let u = diff(&g, root, "sub/new [x].txt").unwrap();
        assert!(u.text.contains("+hello"));
        assert!(diff(&g, root, "other.txt").is_err());
        assert!(diff(&g, root, "../a.txt").is_err());
    }
}
