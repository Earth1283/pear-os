use std::{
    io,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use axum::{
    Json,
    body::Body,
    extract::{Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
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

/// Parses a single `Range: bytes=…` spec against a file of `len` bytes.
/// `None` means "no usable range, send the whole file"; `Some(Err(()))` means unsatisfiable.
/// Multi-range requests are treated as "send everything", which the spec allows.
fn parse_range(value: &str, len: u64) -> Option<Result<(u64, u64), ()>> {
    let spec = value.trim().strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (a, b) = spec.split_once('-')?;
    let (a, b) = (a.trim(), b.trim());
    if len == 0 {
        return Some(Err(()));
    }
    let (start, end) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        if n == 0 {
            return Some(Err(()));
        }
        (len.saturating_sub(n), len - 1)
    } else {
        let start: u64 = a.parse().ok()?;
        let end = if b.is_empty() { len - 1 } else { b.parse::<u64>().ok()?.min(len - 1) };
        (start, end)
    };
    if start >= len || start > end {
        return Some(Err(()));
    }
    Some(Ok((start, end)))
}

pub async fn read(State(s): State<Shared>, Query(q): Query<PathQuery>, headers: HeaderMap) -> Result<Response, ApiError> {
    let path = safe_path(&s.root, &q.path)?;
    let mut file = tokio::fs::File::open(&path).await.map_err(ApiError::io)?;
    let len = file.metadata().await.map_err(ApiError::io)?.len();
    let mime = mime_guess::from_path(&path).first_or_octet_stream();
    let name = path.file_name().map(|n| n.to_string_lossy().replace('"', "")).unwrap_or_default();
    let disposition = if q.download { format!("attachment; filename=\"{name}\"") } else { format!("inline; filename=\"{name}\"") };
    let common = [
        (header::CONTENT_TYPE, mime.to_string()),
        (header::CONTENT_DISPOSITION, disposition),
        (header::CONTENT_SECURITY_POLICY, "sandbox".to_string()),
        (header::ACCEPT_RANGES, "bytes".to_string()),
    ];

    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok()).and_then(|v| parse_range(v, len));
    match range {
        Some(Ok((start, end))) => {
            file.seek(io::SeekFrom::Start(start)).await.map_err(ApiError::io)?;
            let n = end - start + 1;
            Ok((
                StatusCode::PARTIAL_CONTENT,
                common,
                [(header::CONTENT_LENGTH, n.to_string()), (header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))],
                Body::from_stream(ReaderStream::new(file.take(n))),
            )
                .into_response())
        }
        Some(Err(())) => Ok((StatusCode::RANGE_NOT_SATISFIABLE, [(header::CONTENT_RANGE, format!("bytes */{len}"))]).into_response()),
        None => Ok((common, [(header::CONTENT_LENGTH, len.to_string())], Body::from_stream(ReaderStream::new(file))).into_response()),
    }
}

#[derive(Serialize)]
pub struct Song {
    path: String,
    size: u64,
    modified: u64,
}

const AUDIO_EXT: &[&str] = &["mp3", "m4a", "aac", "flac", "wav", "ogg", "oga", "opus"];
const MAX_SONGS: usize = 20_000;
const MAX_DEPTH: usize = 10;

fn scan_songs(root: &Path) -> Vec<Song> {
    let mut out = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            // Hidden entries (including .Trash and half-finished uploads) stay out of the library.
            // `file_type` doesn't follow symlinks, so a link can't lead the scan out of PearDrive.
            if name.starts_with('.') {
                continue;
            }
            let Ok(ty) = e.file_type() else { continue };
            if ty.is_dir() {
                if depth < MAX_DEPTH {
                    stack.push((e.path(), depth + 1));
                }
            } else if ty.is_file() {
                let ext = Path::new(&name).extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
                if !AUDIO_EXT.contains(&ext.as_str()) {
                    continue;
                }
                let Ok(rel) = e.path().strip_prefix(root).map(|p| p.to_string_lossy().replace('\\', "/")) else { continue };
                let Ok(meta) = e.metadata() else { continue };
                out.push(Song {
                    path: format!("/{rel}"),
                    size: meta.len(),
                    modified: meta.modified().ok().and_then(|m| m.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0),
                });
                if out.len() >= MAX_SONGS {
                    return out;
                }
            }
        }
    }
    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    out
}

pub async fn music_library(State(s): State<Shared>) -> Result<Json<Vec<Song>>, ApiError> {
    let root = s.root.clone();
    let songs = tokio::task::spawn_blocking(move || scan_songs(&root))
        .await
        .map_err(|e| ApiError::bad(&e.to_string()))?;
    Ok(Json(songs))
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
    fn parses_ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some(Ok((0, 99))));
        assert_eq!(parse_range("bytes=500-", 1000), Some(Ok((500, 999))));
        assert_eq!(parse_range("bytes=-100", 1000), Some(Ok((900, 999))));
        assert_eq!(parse_range("bytes=900-5000", 1000), Some(Ok((900, 999))), "end is clamped");
        assert_eq!(parse_range("bytes=-5000", 1000), Some(Ok((0, 999))), "suffix larger than the file");
        assert_eq!(parse_range("bytes=1000-", 1000), Some(Err(())), "start past the end");
        assert_eq!(parse_range("bytes=50-10", 1000), Some(Err(())), "backwards");
        assert_eq!(parse_range("bytes=0-0", 0), Some(Err(())), "empty file");
        assert_eq!(parse_range("bytes=0-1,5-9", 1000), None, "multi-range falls back to the whole file");
        assert_eq!(parse_range("items=0-1", 1000), None);
        assert_eq!(parse_range("bytes=abc-", 1000), None);
    }

    #[test]
    fn scan_finds_only_visible_audio() {
        let base = std::env::temp_dir().join(format!("pearos-scan-{}", std::process::id()));
        let root = base.join("drive");
        std::fs::create_dir_all(root.join("Music/Album")).unwrap();
        std::fs::create_dir_all(root.join(".Trash")).unwrap();
        std::fs::write(root.join("Music/Album/01 One.mp3"), b"x").unwrap();
        std::fs::write(root.join("Music/two.FLAC"), b"x").unwrap();
        std::fs::write(root.join("Music/notes.txt"), b"x").unwrap();
        std::fs::write(root.join(".Trash/gone.mp3"), b"x").unwrap();
        std::fs::write(root.join(".hidden.mp3"), b"x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/usr", root.join("Music/escape")).unwrap();
        let root = root.canonicalize().unwrap();
        let paths: Vec<_> = scan_songs(&root).into_iter().map(|s| s.path).collect();
        assert_eq!(paths, vec!["/Music/Album/01 One.mp3", "/Music/two.FLAC"]);
        std::fs::remove_dir_all(&base).unwrap();
    }

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
