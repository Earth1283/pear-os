//! Streams a file from archive.org to the logged-in browser.
//!
//! Browsers cannot fetch archive.org directly (it sends no CORS headers), which is what Boot Camp needs to get a
//! Windows disc image. So pearosd fetches it and passes the bytes through. This is deliberately not a general
//! proxy: only https archive.org hosts, only `/download/` paths, and every redirect hop is checked again.

use axum::{
    body::Body,
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use url::Url;

use crate::Shared;

const MAX_HOPS: usize = 6;

#[derive(Deserialize)]
pub struct Params {
    url: String,
}

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

pub async fn archive(State(s): State<Shared>, req_headers: HeaderMap, Query(q): Query<Params>) -> Response {
    let Ok(mut url) = Url::parse(&q.url) else {
        return refuse(StatusCode::BAD_REQUEST, "That is not a URL.");
    };
    // The first hop must be a download link. Redirects land on mirror hosts with other paths, so only the host is rechecked after.
    if !allowed(&url) || !url.path().starts_with("/download/") {
        return refuse(StatusCode::FORBIDDEN, "pearosd only downloads from https://archive.org/download/… links.");
    }
    let client = s.proxy.download_client();

    for _ in 0..MAX_HOPS {
        let mut rb = client.get(url.clone());
        // Forwarding Range lets the browser resume or fetch in pieces.
        if let Some(r) = req_headers.get(header::RANGE) {
            rb = rb.header(header::RANGE, r.clone());
        }
        let resp = match rb.send().await {
            Ok(r) => r,
            Err(e) => return refuse(StatusCode::BAD_GATEWAY, format!("Could not reach {}: {e}", url.host_str().unwrap_or("archive.org"))),
        };

        let status = resp.status();
        if status.is_redirection() {
            let Some(next) = resp.headers().get(header::LOCATION).and_then(|l| l.to_str().ok()).and_then(|l| url.join(l).ok()) else {
                return refuse(StatusCode::BAD_GATEWAY, "archive.org sent a redirect without a destination.");
            };
            if !allowed(&next) {
                return refuse(StatusCode::FORBIDDEN, "archive.org redirected somewhere that is not archive.org. Refusing to follow.");
            }
            url = next;
            continue;
        }
        if !status.is_success() {
            return refuse(StatusCode::BAD_GATEWAY, format!("archive.org answered {status} for that file."));
        }

        let mut out = HeaderMap::new();
        for h in [header::CONTENT_LENGTH, header::CONTENT_RANGE, header::ACCEPT_RANGES, header::ETAG, header::LAST_MODIFIED] {
            if let Some(v) = resp.headers().get(&h) {
                out.insert(h, v.clone());
            }
        }
        // It is a disc image, whatever archive.org calls it.
        out.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"));
        out.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        return (status, out, Body::from_stream(resp.bytes_stream())).into_response();
    }
    refuse(StatusCode::BAD_GATEWAY, "archive.org redirected too many times.")
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
