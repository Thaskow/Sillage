pub mod backend;
pub mod client;
pub mod proto;
#[cfg(windows)]
pub mod security;
pub mod server;

pub use backend::Backend;
pub use client::{HostClient, HostError};

use std::time::Duration;

pub const IDLE_EXIT: Duration = Duration::from_secs(30);

#[cfg(windows)]
pub fn pipe_name() -> std::io::Result<String> {
    let flavor = if cfg!(debug_assertions) { "dev-" } else { "" };
    Ok(format!(
        r"\\.\pipe\sillage-{flavor}{}",
        security::current_user_sid()?
    ))
}

#[cfg(not(windows))]
pub fn pipe_name() -> std::io::Result<String> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "démon disponible sous Windows uniquement",
    ))
}
