//! Streams a file from archive.org to the logged-in browser, and keeps a copy.
//!
//! Browsers cannot fetch archive.org directly (it sends no CORS headers), which is what Boot Camp needs to get a
//! Windows disc image. So pearosd fetches it and passes the bytes through. This is deliberately not a general
//! proxy: only https archive.org hosts, only `/download/` paths, and every redirect hop is checked again.
//!
//! Copies are kept in `<PearDrive>/Downloads/<item>/<file>`, so the next person gets it at disk speed and
//! archive.org is only asked once. A download is a background job: it keeps going if the first client leaves, and
//! anyone who asks for the same file meanwhile reads the growing file instead of starting another transfer.
//! Delete the folder (in Finder or the Terminal) to get the space back.

use std::{
    collections::HashMap,
    fmt::Display,
    io,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use axum::{
    body::{Body, Bytes},
    extract::{Query, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use futures_util::{Stream, StreamExt, stream};
use serde::Deserialize;
use tokio::{
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    sync::watch,
};
use tokio_util::io::ReaderStream;
use url::Url;

use crate::Shared;

const MAX_HOPS: usize = 6;
/// Bigger than this is streamed through without keeping a copy.
const MAX_CACHE: u64 = 4 * 1024 * 1024 * 1024;
/// How much of the growing file a follower reads at a time.
const READ_STEP: u64 = 256 * 1024;
/// How often the filler publishes progress to followers.
const PUBLISH_EVERY: u64 = 256 * 1024;
const CACHE_HEADER: HeaderName = HeaderName::from_static("x-pearos-cache");

#[derive(Deserialize)]
pub struct Params {
    url: String,
}

/* ------------------------------------------------------------------ what we will fetch */

fn archive_host(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    h == "archive.org" || h.ends_with(".archive.org")
}

/// Any URL we are willing to talk to: https, a real archive.org host, no credentials, default port.
fn allowed(u: &Url) -> bool {
    u.scheme() == "https" && u.username().is_empty() && u.password().is_none() && u.port().is_none_or(|p| p == 443) && u.host_str().is_some_and(archive_host)
}

fn refuse(code: StatusCode, msg: impl Into<String>) -> Response {
    (code, [(header::CONTENT_TYPE, "text/plain; charset=utf-8")], msg.into()).into_response()
}

/// Where a copy of `url` lives: `<root>/Downloads/<item>/<file…>`. `None` means "do not cache this one".
/// Every piece comes from the URL, so each one is checked: nothing may point outside the folder or be hidden.
fn cache_path(root: &Path, url: &Url) -> Option<PathBuf> {
    let mut segs = url.path_segments()?;
    if segs.next()? != "download" {
        return None;
    }
    let item = segs.next()?;
    if item.is_empty() || item.starts_with('.') || !item.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')) {
        return None;
    }
    let mut path = root.join("Downloads").join(item);
    let mut parts = 0;
    for seg in segs {
        let name = percent_encoding::percent_decode_str(seg).decode_utf8().ok()?;
        if name.is_empty() || name.starts_with('.') || name.len() > 200 || name.contains(['/', '\\', '\0']) || name.chars().any(char::is_control) {
            return None;
        }
        path.push(name.as_ref());
        parts += 1;
    }
    (parts > 0).then_some(path)
}

/// The hidden file a download is written to until it is whole.
fn part_path(dest: &Path) -> PathBuf {
    let name = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    dest.with_file_name(format!(".{name}.part"))
}

/* ------------------------------------------------------------------ downloads in flight */

#[derive(Clone, Copy, PartialEq, Debug)]
enum Phase {
    Running,
    Done,
    Failed,
}

#[derive(Clone, Copy, Debug)]
struct Fill {
    /// Bytes safely on disk, in order from the start.
    written: u64,
    phase: Phase,
}

pub struct Downloads {
    enabled: bool,
    /// Held while deciding "is this cached, running, or new?" and while a finished copy is moved into place, so
    /// those two things cannot race and start a second transfer for a file that just completed.
    gate: tokio::sync::Mutex<()>,
    active: Mutex<HashMap<PathBuf, (u64, watch::Receiver<Fill>)>>,
}

impl Downloads {
    pub fn new(enabled: bool) -> Arc<Self> {
        Arc::new(Self { enabled, gate: tokio::sync::Mutex::new(()), active: Mutex::new(HashMap::new()) })
    }

    fn running(&self, dest: &Path) -> Option<(u64, watch::Receiver<Fill>)> {
        self.active.lock().unwrap().get(dest).cloned()
    }

    /// Begins copying `stream` into `file` (already created at `part`) on a background task. The caller holds
    /// `gate`, so this is registered before anyone else can look.
    fn start<S, E>(self: &Arc<Self>, dest: PathBuf, part: PathBuf, total: u64, file: tokio::fs::File, stream: S) -> watch::Receiver<Fill>
    where
        S: Stream<Item = Result<Bytes, E>> + Send + Unpin + 'static,
        E: Display + Send + 'static,
    {
        let (tx, rx) = watch::channel(Fill { written: 0, phase: Phase::Running });
        self.active.lock().unwrap().insert(dest.clone(), (total, rx.clone()));
        let me = self.clone();
        tokio::spawn(async move { me.fill(dest, part, total, file, stream, tx).await });
        rx
    }

    async fn fill<S, E>(self: Arc<Self>, dest: PathBuf, part: PathBuf, total: u64, mut file: tokio::fs::File, mut stream: S, tx: watch::Sender<Fill>)
    where
        S: Stream<Item = Result<Bytes, E>> + Send + Unpin,
        E: Display + Send,
    {
        let copied: Result<(), String> = async {
            let (mut written, mut published) = (0u64, 0u64);
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| format!("the download broke off: {e}"))?;
                written += chunk.len() as u64;
                if written > total {
                    return Err("archive.org sent more bytes than it promised".into());
                }
                file.write_all(&chunk).await.map_err(|e| format!("could not write the copy: {e}"))?;
                if written - published >= PUBLISH_EVERY {
                    // Flush first: followers read this file through their own handle, so the bytes must really be there.
                    file.flush().await.map_err(|e| format!("could not write the copy: {e}"))?;
                    published = written;
                    tx.send_replace(Fill { written, phase: Phase::Running });
                }
            }
            file.flush().await.map_err(|e| format!("could not write the copy: {e}"))?;
            if written != total {
                return Err(format!("the download stopped at {written} of {total} bytes"));
            }
            Ok(())
        }
        .await;

        // Moving it into place and forgetting it was running happen together, under the gate.
        let _gate = self.gate.lock().await;
        let outcome = match copied {
            Ok(()) => tokio::fs::rename(&part, &dest).await.map_err(|e| format!("could not finish the copy: {e}")),
            Err(e) => Err(e),
        };
        match outcome {
            Ok(()) => {
                tx.send_replace(Fill { written: total, phase: Phase::Done });
            }
            Err(e) => {
                eprintln!("pearosd: download of {} failed: {e}", dest.display());
                let _ = tokio::fs::remove_file(&part).await;
                tx.send_replace(Fill { written: 0, phase: Phase::Failed });
            }
        }
        self.active.lock().unwrap().remove(&dest);
    }
}

/// Streams a file that is still being written. Ends when `total` bytes have been sent, or errors if the download
/// fails, so the browser sees a failed transfer rather than a silently short file.
fn follow(file: tokio::fs::File, total: u64, rx: watch::Receiver<Fill>) -> Body {
    Body::from_stream(stream::unfold((file, 0u64, rx), move |(mut file, mut pos, mut rx)| async move {
        loop {
            if pos >= total {
                return None;
            }
            let st = *rx.borrow();
            let avail = st.written.saturating_sub(pos);
            if avail > 0 {
                let mut buf = vec![0u8; avail.min(READ_STEP) as usize];
                return match file.read_exact(&mut buf).await {
                    Ok(_) => {
                        pos += buf.len() as u64;
                        Some((Ok(Bytes::from(buf)), (file, pos, rx)))
                    }
                    Err(e) => Some((Err(e), (file, total, rx))),
                };
            }
            if st.phase == Phase::Failed {
                return Some((Err(io::Error::other("the download failed on the server")), (file, total, rx)));
            }
            if rx.changed().await.is_err() {
                // The filler is gone. If it finished, the loop reads what is left; if not, that is an error.
                let st = *rx.borrow();
                if st.written <= pos && st.phase != Phase::Done {
                    return Some((Err(io::Error::other("the download ended early on the server")), (file, total, rx)));
                }
            }
        }
    }))
}

/* ------------------------------------------------------------------ talking to archive.org */

/// Fetches `url` from archive.org, following redirects by hand so each hop can be checked.
async fn upstream(client: &reqwest::Client, mut url: Url, range: Option<&HeaderValue>) -> Result<reqwest::Response, Response> {
    for _ in 0..MAX_HOPS {
        let mut rb = client.get(url.clone());
        if let Some(r) = range {
            rb = rb.header(header::RANGE, r.clone());
        }
        let resp = rb.send().await.map_err(|e| refuse(StatusCode::BAD_GATEWAY, format!("Could not reach {}: {e}", url.host_str().unwrap_or("archive.org"))))?;
        let status = resp.status();
        if status.is_redirection() {
            let next = resp.headers().get(header::LOCATION).and_then(|l| l.to_str().ok()).and_then(|l| url.join(l).ok());
            let Some(next) = next else {
                return Err(refuse(StatusCode::BAD_GATEWAY, "archive.org sent a redirect without a destination."));
            };
            if !allowed(&next) {
                return Err(refuse(StatusCode::FORBIDDEN, "archive.org redirected somewhere that is not archive.org. Refusing to follow."));
            }
            url = next;
            continue;
        }
        if !status.is_success() {
            return Err(refuse(StatusCode::BAD_GATEWAY, format!("archive.org answered {status} for that file.")));
        }
        return Ok(resp);
    }
    Err(refuse(StatusCode::BAD_GATEWAY, "archive.org redirected too many times."))
}

/// Headers for a disc image, whatever archive.org calls it.
fn base_headers(tag: &'static str) -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    h.insert(CACHE_HEADER, HeaderValue::from_static(tag));
    h
}

/// Passes archive.org's response through without keeping anything. Used when caching is off or not possible.
fn pass_through(resp: reqwest::Response) -> Response {
    let status = resp.status();
    let mut out = base_headers("bypass");
    for h in [header::CONTENT_LENGTH, header::CONTENT_RANGE, header::ACCEPT_RANGES, header::ETAG, header::LAST_MODIFIED] {
        if let Some(v) = resp.headers().get(&h) {
            out.insert(h, v.clone());
        }
    }
    (status, out, Body::from_stream(resp.bytes_stream())).into_response()
}

/// Serves a complete copy from disk, with `Range` support.
async fn serve_file(path: &Path, req: &HeaderMap, tag: &'static str) -> Response {
    let mut file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(e) => return refuse(StatusCode::INTERNAL_SERVER_ERROR, format!("Could not read the cached copy: {e}")),
    };
    let len = match file.metadata().await {
        Ok(m) => m.len(),
        Err(e) => return refuse(StatusCode::INTERNAL_SERVER_ERROR, format!("Could not read the cached copy: {e}")),
    };
    let mut out = base_headers(tag);
    out.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    let range = req.get(header::RANGE).and_then(|v| v.to_str().ok()).and_then(|v| crate::files::parse_range(v, len));
    match range {
        Some(Ok((start, end))) => {
            if file.seek(io::SeekFrom::Start(start)).await.is_err() {
                return refuse(StatusCode::INTERNAL_SERVER_ERROR, "Could not read the cached copy.");
            }
            let n = end - start + 1;
            out.insert(header::CONTENT_LENGTH, HeaderValue::from(n));
            if let Ok(v) = HeaderValue::from_str(&format!("bytes {start}-{end}/{len}")) {
                out.insert(header::CONTENT_RANGE, v);
            }
            (StatusCode::PARTIAL_CONTENT, out, Body::from_stream(ReaderStream::new(file.take(n)))).into_response()
        }
        Some(Err(())) => (StatusCode::RANGE_NOT_SATISFIABLE, [(header::CONTENT_RANGE, format!("bytes */{len}"))]).into_response(),
        None => {
            out.insert(header::CONTENT_LENGTH, HeaderValue::from(len));
            (StatusCode::OK, out, Body::from_stream(ReaderStream::new(file))).into_response()
        }
    }
}

/// Serves a file that is still arriving. `Range` is ignored (always the whole file), which HTTP allows.
async fn serve_growing(dest: &Path, total: u64, rx: watch::Receiver<Fill>, tag: &'static str) -> Response {
    // The copy may have been renamed into place a moment ago, so try both names.
    let file = match tokio::fs::File::open(part_path(dest)).await {
        Ok(f) => f,
        Err(_) => match tokio::fs::File::open(dest).await {
            Ok(f) => f,
            Err(e) => return refuse(StatusCode::INTERNAL_SERVER_ERROR, format!("Could not read the copy being downloaded: {e}")),
        },
    };
    let mut out = base_headers(tag);
    out.insert(header::CONTENT_LENGTH, HeaderValue::from(total));
    (StatusCode::OK, out, follow(file, total, rx)).into_response()
}

pub async fn archive(State(s): State<Shared>, req_headers: HeaderMap, Query(q): Query<Params>) -> Response {
    let Ok(url) = Url::parse(&q.url) else {
        return refuse(StatusCode::BAD_REQUEST, "That is not a URL.");
    };
    // The first hop must be a download link. Redirects land on mirror hosts with other paths, so only the host is rechecked after.
    if !allowed(&url) || !url.path().starts_with("/download/") {
        return refuse(StatusCode::FORBIDDEN, "pearosd only downloads from https://archive.org/download/… links.");
    }
    let client = s.proxy.download_client();

    let dest = if s.downloads.enabled { cache_path(&s.root, &url) } else { None };
    let Some(dest) = dest else {
        // Caching is off or this URL is not cacheable: forward Range so the browser can still resume.
        return match upstream(client, url, req_headers.get(header::RANGE)).await {
            Ok(resp) => pass_through(resp),
            Err(e) => e,
        };
    };

    // Fast path: a finished copy.
    if tokio::fs::metadata(&dest).await.is_ok_and(|m| m.is_file()) {
        return serve_file(&dest, &req_headers, "hit").await;
    }

    // Decide under the gate: cached by now, already running, or new.
    let gate = s.downloads.gate.lock().await;
    if tokio::fs::metadata(&dest).await.is_ok_and(|m| m.is_file()) {
        drop(gate);
        return serve_file(&dest, &req_headers, "hit").await;
    }
    if let Some((total, rx)) = s.downloads.running(&dest) {
        drop(gate);
        return serve_growing(&dest, total, rx, "join").await;
    }

    // New. If the copy cannot be started for any reason, the download still works, just uncached.
    let part = part_path(&dest);
    let file = match dest.parent() {
        Some(dir) => match tokio::fs::create_dir_all(dir).await {
            Ok(()) => tokio::fs::File::create(&part).await.ok(),
            Err(_) => None,
        },
        None => None,
    };
    let resp = match upstream(client, url, None).await {
        Ok(r) => r,
        Err(e) => {
            drop(file);
            let _ = tokio::fs::remove_file(&part).await;
            return e;
        }
    };
    let total = resp.content_length().filter(|n| *n > 0 && *n <= MAX_CACHE);
    let (Some(file), Some(total)) = (file, total) else {
        let _ = tokio::fs::remove_file(&part).await;
        drop(gate);
        return pass_through(resp);
    };
    let rx = s.downloads.start(dest.clone(), part, total, file, resp.bytes_stream());
    drop(gate);
    serve_growing(&dest, total, rx, "fill").await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn ok(s: &str) -> bool {
        allowed(&Url::parse(s).unwrap())
    }

    #[test]
    fn accepts_archive_org() {
        assert!(ok("https://archive.org/download/windows-98-se-isofile/Windows%2098%20Second%20Edition.iso"));
        assert!(ok("https://ia800509.us.archive.org/29/items/windows-98-se-isofile/x.iso"));
        assert!(ok("https://ARCHIVE.ORG/download/a/b"));
    }

    #[test]
    fn rejects_everything_else() {
        assert!(!ok("http://archive.org/download/a/b"), "plain http");
        assert!(!ok("https://archive.org.evil.com/download/a/b"), "suffix trick");
        assert!(!ok("https://evilarchive.org/download/a/b"), "no dot before archive.org");
        assert!(!ok("https://archive.org@evil.com/download/a/b"), "userinfo trick");
        assert!(!ok("https://user:pw@archive.org/download/a/b"), "credentials");
        assert!(!ok("https://archive.org:8443/download/a/b"), "odd port");
        assert!(!ok("https://127.0.0.1/download/a/b"), "loopback");
        assert!(!ok("https://example.com/download/a/b"), "other host");
    }

    fn cp(u: &str) -> Option<PathBuf> {
        cache_path(Path::new("/drive"), &Url::parse(u).unwrap())
    }

    #[test]
    fn cache_path_is_inside_downloads() {
        assert_eq!(cp("https://archive.org/download/windows-98-se-isofile/Windows%2098%20Second%20Edition.iso"), Some(PathBuf::from("/drive/Downloads/windows-98-se-isofile/Windows 98 Second Edition.iso")));
        assert_eq!(cp("https://archive.org/download/item/sub/dir/file.bin"), Some(PathBuf::from("/drive/Downloads/item/sub/dir/file.bin")));
    }

    #[test]
    fn cache_path_refuses_anything_odd() {
        assert_eq!(cp("https://archive.org/download/item"), None, "no file");
        assert_eq!(cp("https://archive.org/download/item/"), None, "empty file name");
        assert_eq!(cp("https://archive.org/details/item/file"), None, "not a download link");
        assert_eq!(cp("https://archive.org/download/../etc/passwd"), None, "dot-dot item");
        assert_eq!(cp("https://archive.org/download/item/%2e%2e/x"), None, "encoded dot-dot");
        assert_eq!(cp("https://archive.org/download/item/a%2fb"), None, "encoded slash");
        assert_eq!(cp("https://archive.org/download/item/a%5cb"), None, "encoded backslash");
        assert_eq!(cp("https://archive.org/download/item/%00x"), None, "NUL");
        assert_eq!(cp("https://archive.org/download/item/.hidden"), None, "hidden file");
        assert_eq!(cp("https://archive.org/download/.item/file"), None, "hidden item");
        assert_eq!(cp("https://archive.org/download/it%20em/file"), None, "odd item name");
    }

    #[test]
    fn part_files_are_hidden_and_next_to_the_copy() {
        assert_eq!(part_path(Path::new("/d/Downloads/i/x.iso")), PathBuf::from("/d/Downloads/i/.x.iso.part"));
    }

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pearosd-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// A fake archive.org: `n` chunks of 100 KB with a pause between them, optionally breaking off after `fail_after`.
    fn fake(n: usize, fail_after: Option<usize>) -> (Vec<u8>, impl Stream<Item = Result<Bytes, String>> + Send + Unpin + 'static) {
        let data: Vec<u8> = (0..n * 100_000).map(|i| (i % 251) as u8).collect();
        let chunks: Vec<Bytes> = data.chunks(100_000).map(|c| Bytes::copy_from_slice(c)).collect();
        let s = stream::unfold((chunks, 0usize), move |(chunks, i)| async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            if fail_after == Some(i) {
                return Some((Err("connection reset".to_string()), (chunks, usize::MAX - 1)));
            }
            chunks.get(i).cloned().map(|c| (Ok(c), (chunks, i + 1)))
        });
        (data, Box::pin(s))
    }

    async fn collect(body: Body) -> Result<Vec<u8>, String> {
        let mut out = Vec::new();
        let mut s = body.into_data_stream();
        while let Some(c) = s.next().await {
            out.extend_from_slice(&c.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    async fn begin(dl: &Arc<Downloads>, dir: &Path, total: u64, s: impl Stream<Item = Result<Bytes, String>> + Send + Unpin + 'static) -> (PathBuf, watch::Receiver<Fill>, tokio::fs::File) {
        let dest = dir.join("Downloads/item/disc.iso");
        let part = part_path(&dest);
        tokio::fs::create_dir_all(dest.parent().unwrap()).await.unwrap();
        let file = tokio::fs::File::create(&part).await.unwrap();
        let reader = tokio::fs::File::open(&part).await.unwrap();
        let _gate = dl.gate.lock().await;
        let rx = dl.start(dest.clone(), part, total, file, s);
        (dest, rx, reader)
    }

    #[tokio::test]
    async fn two_followers_get_the_whole_file_from_one_download() {
        let dir = temp_dir("follow");
        let dl = Downloads::new(true);
        let (data, s) = fake(30, None);
        let (dest, rx, reader) = begin(&dl, &dir, data.len() as u64, s).await;
        let second = tokio::fs::File::open(part_path(&dest)).await.unwrap();
        let (a, b) = tokio::join!(collect(follow(reader, data.len() as u64, rx.clone())), collect(follow(second, data.len() as u64, rx)));
        assert!(a.unwrap() == data, "first follower got every byte, in order");
        assert!(b.unwrap() == data, "second follower got every byte, in order");
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(std::fs::read(&dest).unwrap(), data, "the finished copy is in place and complete");
        assert!(!part_path(&dest).exists(), "the hidden part file is gone");
        assert!(dl.running(&dest).is_none(), "no longer marked as running");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn a_broken_download_fails_the_follower_and_leaves_no_copy() {
        let dir = temp_dir("broken");
        let dl = Downloads::new(true);
        let (data, s) = fake(10, Some(4));
        let (dest, rx, reader) = begin(&dl, &dir, data.len() as u64, s).await;
        let got = collect(follow(reader, data.len() as u64, rx)).await;
        assert!(got.is_err(), "the browser sees a failed transfer, not a short file");
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!dest.exists(), "no final copy");
        assert!(!part_path(&dest).exists(), "no leftover part file");
        assert!(dl.running(&dest).is_none(), "can be retried");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn a_short_download_is_not_kept() {
        let dir = temp_dir("short");
        let dl = Downloads::new(true);
        let (data, s) = fake(5, None);
        // Promise more than will arrive.
        let (dest, rx, reader) = begin(&dl, &dir, data.len() as u64 + 1, s).await;
        let got = collect(follow(reader, data.len() as u64 + 1, rx)).await;
        assert!(got.is_err());
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!dest.exists() && !part_path(&dest).exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn an_oversized_stream_is_not_kept() {
        let dir = temp_dir("long");
        let dl = Downloads::new(true);
        let (data, s) = fake(5, None);
        // Promise less than will arrive.
        let (dest, rx, reader) = begin(&dl, &dir, data.len() as u64 - 1, s).await;
        let _ = collect(follow(reader, data.len() as u64 - 1, rx)).await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!dest.exists() && !part_path(&dest).exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
