use std::{
    io,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use axum::{
    Json,
    body::Body,
    extract::{Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;

use crate::Shared;

pub fn seed(root: &Path) {
    let welcome = root.join("Welcome to PearDrive.txt");
    if std::fs::read_dir(root).map(|mut d| d.next().is_none()).unwrap_or(false) {
        let _ = std::fs::create_dir_all(root.join("Documents"));
        let _ = std::fs::write(
            welcome,
            "This folder is real.\n\nFiles you put here live on the machine running pearosd.\nDelete this file; it won't mind.\n",
        );
    }
}

pub fn safe_path(root: &Path, rel: &str) -> Result<PathBuf, ApiError> {
    let mut p = root.to_path_buf();
    for comp in Path::new(rel.trim_start_matches('/')).components() {
        match comp {
            Component::Normal(c) => p.push(c),
            Component::CurDir => {}
            _ => return Err(ApiError::bad("path escapes PearDrive")),
        }
    }
    let mut probe = p.clone();
    while !probe.exists() {
        if !probe.pop() {
            break;
        }
    }
    let real = probe.canonicalize().map_err(ApiError::io)?;
    if !real.starts_with(root) {
        return Err(ApiError::bad("path escapes PearDrive"));
    }
    if p.exists() {
        let real = p.canonicalize().map_err(ApiError::io)?;
        if !real.starts_with(root) {
            return Err(ApiError::bad("symlink escapes PearDrive"));
        }
    }
    Ok(p)
}

pub struct ApiError(StatusCode, String);

impl ApiError {
    pub fn bad(msg: &str) -> Self {
        Self(StatusCode::BAD_REQUEST, msg.into())
    }
    pub fn io(e: io::Error) -> Self {
        let code = match e.kind() {
            io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
            io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
            io::ErrorKind::AlreadyExists => StatusCode::CONFLICT,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self(code, e.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

#[derive(Deserialize)]
pub struct PathQuery {
    path: String,
    #[serde(default)]
    download: bool,
}

#[derive(Serialize)]
pub struct Entry {
    name: String,
    dir: bool,
    size: u64,
    modified: u64,
}

pub async fn list(State(s): State<Shared>, Query(q): Query<PathQuery>) -> Result<Json<Vec<Entry>>, ApiError> {
    let dir = safe_path(&s.root, &q.path)?;
    let mut rd = tokio::fs::read_dir(&dir).await.map_err(ApiError::io)?;
    let mut out = Vec::new();
    while let Some(e) = rd.next_entry().await.map_err(ApiError::io)? {
        let Ok(meta) = e.metadata().await else { continue };
        out.push(Entry {
            name: e.file_name().to_string_lossy().into_owned(),
            dir: meta.is_dir(),
            size: meta.len(),
            modified: meta.modified().ok().and_then(|m| m.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0),
        });
    }
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(Json(out))
}

pub async fn read(State(s): State<Shared>, Query(q): Query<PathQuery>) -> Result<Response, ApiError> {
    let path = safe_path(&s.root, &q.path)?;
    let file = tokio::fs::File::open(&path).await.map_err(ApiError::io)?;
    let len = file.metadata().await.map_err(ApiError::io)?.len();
    let mime = mime_guess::from_path(&path).first_or_octet_stream();
    let name = path.file_name().map(|n| n.to_string_lossy().replace('"', "")).unwrap_or_default();
    let disposition = if q.download { format!("attachment; filename=\"{name}\"") } else { format!("inline; filename=\"{name}\"") };
    Ok((
        [
            (header::CONTENT_TYPE, mime.to_string()),
            (header::CONTENT_LENGTH, len.to_string()),
            (header::CONTENT_DISPOSITION, disposition),
            (header::CONTENT_SECURITY_POLICY, "sandbox".to_string()),
        ],
        Body::from_stream(ReaderStream::new(file)),
    )
        .into_response())
}

pub async fn write(State(s): State<Shared>, Query(q): Query<PathQuery>, body: Body) -> Result<Json<serde_json::Value>, ApiError> {
    let path = safe_path(&s.root, &q.path)?;
    if path.is_dir() {
        return Err(ApiError::bad("that's a folder"));
    }
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(ApiError::io)?;
    }
    let tmp = path.with_file_name(format!(".{}.pearos-upload", path.file_name().unwrap_or_default().to_string_lossy()));
    let mut f = tokio::fs::File::create(&tmp).await.map_err(ApiError::io)?;
    let mut stream = body.into_data_stream();
    let mut written = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| ApiError::bad(&e.to_string()))?;
        written += chunk.len() as u64;
        f.write_all(&chunk).await.map_err(ApiError::io)?;
    }
    f.flush().await.map_err(ApiError::io)?;
    drop(f);
    tokio::fs::rename(&tmp, &path).await.map_err(ApiError::io)?;
    Ok(Json(json!({ "ok": true, "size": written })))
}

#[derive(Deserialize)]
pub struct PathBody {
    path: String,
}

pub async fn mkdir(State(s): State<Shared>, Json(b): Json<PathBody>) -> Result<Json<serde_json::Value>, ApiError> {
    let path = safe_path(&s.root, &b.path)?;
    tokio::fs::create_dir(&path).await.map_err(ApiError::io)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct RenameBody {
    from: String,
    to: String,
}

pub async fn rename(State(s): State<Shared>, Json(b): Json<RenameBody>) -> Result<Json<serde_json::Value>, ApiError> {
    let from = safe_path(&s.root, &b.from)?;
    let to = safe_path(&s.root, &b.to)?;
    if from == s.root {
        return Err(ApiError::bad("can't move PearDrive itself"));
    }
    if to.exists() {
        return Err(ApiError::io(io::Error::from(io::ErrorKind::AlreadyExists)));
    }
    tokio::fs::rename(&from, &to).await.map_err(ApiError::io)?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn trash(State(s): State<Shared>, Json(b): Json<PathBody>) -> Result<Json<serde_json::Value>, ApiError> {
    let from = safe_path(&s.root, &b.path)?;
    if from == s.root {
        return Err(ApiError::bad("can't trash PearDrive itself"));
    }
    let bin = s.root.join(".Trash");
    tokio::fs::create_dir_all(&bin).await.map_err(ApiError::io)?;
    let name = from.file_name().unwrap_or_default().to_string_lossy().into_owned();
    let mut target = bin.join(&name);
    let mut i = 2;
    while target.exists() {
        target = bin.join(format!("{name} {i}"));
        i += 1;
    }
    tokio::fs::rename(&from, &target).await.map_err(ApiError::io)?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn delete(State(s): State<Shared>, Json(b): Json<PathBody>) -> Result<Json<serde_json::Value>, ApiError> {
    let path = safe_path(&s.root, &b.path)?;
    if path == s.root {
        return Err(ApiError::bad("nice try"));
    }
    let meta = tokio::fs::symlink_metadata(&path).await.map_err(ApiError::io)?;
    if meta.is_dir() {
        tokio::fs::remove_dir_all(&path).await.map_err(ApiError::io)?;
    } else {
        tokio::fs::remove_file(&path).await.map_err(ApiError::io)?;
    }
    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_escapes() {
        let base = std::env::temp_dir().join(format!("pearos-test-{}", std::process::id()));
        let root = base.join("drive");
        std::fs::create_dir_all(root.join("ok")).unwrap();
        let root = root.canonicalize().unwrap();
        assert!(safe_path(&root, "ok/new.txt").is_ok());
        assert!(safe_path(&root, "/ok").is_ok());
        assert!(safe_path(&root, "../etc/passwd").is_err());
        assert!(safe_path(&root, "ok/../../x").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc", root.join("sneaky")).unwrap();
            assert!(safe_path(&root, "sneaky/passwd").is_err());
            assert!(safe_path(&root, "sneaky").is_err());
        }
        std::fs::remove_dir_all(&base).unwrap();
    }
}
