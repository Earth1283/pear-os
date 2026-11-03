use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::Mutex,
    time::{Duration, Instant},
};

use argon2::Argon2;
use axum::{
    Json,
    extract::{ConnectInfo, Request, State},
    http::{HeaderMap, StatusCode, Uri, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;

use crate::Shared;

const COOKIE: &str = "pearos_session";
const SESSION_TTL: Duration = Duration::from_secs(60 * 60 * 24 * 7);
const MAX_ATTEMPTS: u32 = 8;
const ATTEMPT_WINDOW: Duration = Duration::from_secs(5 * 60);

#[derive(Clone)]
pub struct Session {
    pub expires: Instant,
    pub proxy_token: String,
}

pub struct Auth {
    salt: [u8; 16],
    hash: [u8; 32],
    sessions: Mutex<HashMap<String, Session>>,
    attempts: Mutex<HashMap<IpAddr, (u32, Instant)>>,
}

pub fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::fill(&mut buf[..]);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn random_password() -> String {
    const WORDS: &[&str] = &["pear", "bosc", "anjou", "comice", "seckel", "forelle", "bartlett", "nashi", "kernel", "orchard", "ripe", "crisp", "stem", "leaf", "juicy", "golden"];
    let mut idx = [0u8; 5];
    rand::fill(&mut idx[..]);
    let words: Vec<_> = idx.iter().map(|i| WORDS[*i as usize % WORDS.len()]).collect();
    format!("{}-{}", words.join("-"), &random_hex(4))
}

fn derive(password: &str, salt: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    Argon2::default().hash_password_into(password.as_bytes(), salt, &mut out).expect("argon2");
    out
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

impl Auth {
    pub fn new(password: &str) -> Self {
        let mut salt = [0u8; 16];
        rand::fill(&mut salt[..]);
        Self { hash: derive(password, &salt), salt, sessions: Mutex::default(), attempts: Mutex::default() }
    }

    fn check(&self, password: &str) -> bool {
        ct_eq(&derive(password, &self.salt), &self.hash)
    }

    pub fn session_from(&self, headers: &HeaderMap) -> Option<Session> {
        let token = cookie(headers, COOKIE)?;
        let mut sessions = self.sessions.lock().unwrap();
        let now = Instant::now();
        sessions.retain(|_, s| s.expires > now);
        sessions.get(&token).cloned()
    }

    pub fn proxy_token_valid(&self, token: &str) -> bool {
        let now = Instant::now();
        self.sessions.lock().unwrap().values().any(|s| s.expires > now && ct_eq(s.proxy_token.as_bytes(), token.as_bytes()))
    }

    fn rate_limited(&self, ip: IpAddr) -> bool {
        let mut attempts = self.attempts.lock().unwrap();
        let now = Instant::now();
        let entry = attempts.entry(ip).or_insert((0, now));
        if now.duration_since(entry.1) > ATTEMPT_WINDOW {
            *entry = (0, now);
        }
        entry.0 += 1;
        entry.0 > MAX_ATTEMPTS
    }
}

fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|kv| kv.trim().split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v.to_string())
}

fn normalize_authority(authority: &str, scheme: &str) -> String {
    let a = authority.trim().to_ascii_lowercase();
    let default = match scheme {
        "https" | "wss" => ":443",
        "http" | "ws" => ":80",
        _ => "",
    };
    match a.strip_suffix(default) {
        Some(stripped) if !default.is_empty() => stripped.to_string(),
        _ => a,
    }
}

pub fn origin_ok(headers: &HeaderMap, uri: &Uri) -> bool {
    let Some(origin) = headers.get(header::ORIGIN).and_then(|o| o.to_str().ok()) else {
        return true;
    };
    let Some((scheme, origin_host)) = origin.split_once("://") else {
        return false;
    };
    let host = headers.get(header::HOST).and_then(|h| h.to_str().ok()).map(str::to_string).or_else(|| uri.authority().map(|a| a.as_str().to_string()));
    let Some(host) = host else {
        return false;
    };
    normalize_authority(origin_host, scheme) == normalize_authority(&host, scheme)
}

#[derive(Deserialize)]
pub struct LoginBody {
    password: String,
}

pub async fn login(State(s): State<Shared>, ConnectInfo(addr): ConnectInfo<SocketAddr>, uri: Uri, headers: HeaderMap, Json(body): Json<LoginBody>) -> Response {
    if !origin_ok(&headers, &uri) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if s.auth.rate_limited(addr.ip()) {
        return (StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "Too many attempts. Try again in a few minutes." }))).into_response();
    }
    let ok = {
        let s = s.clone();
        tokio::task::spawn_blocking(move || s.auth.check(&body.password)).await.unwrap_or(false)
    };
    if !ok {
        tokio::time::sleep(Duration::from_millis(400)).await;
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Incorrect password" }))).into_response();
    }
    s.auth.attempts.lock().unwrap().remove(&addr.ip());
    let token = random_hex(32);
    let session = Session { expires: Instant::now() + SESSION_TTL, proxy_token: random_hex(16) };
    s.auth.sessions.lock().unwrap().insert(token.clone(), session.clone());
    let secure = if s.secure { "; Secure" } else { "" };
    let set = format!("{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}{secure}", SESSION_TTL.as_secs());
    ([(header::SET_COOKIE, set)], Json(json!({ "ok": true, "proxyToken": session.proxy_token }))).into_response()
}

pub async fn logout(State(s): State<Shared>, uri: Uri, headers: HeaderMap) -> Response {
    if !origin_ok(&headers, &uri) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if let Some(t) = cookie(&headers, COOKIE) {
        s.auth.sessions.lock().unwrap().remove(&t);
    }
    ([(header::SET_COOKIE, format!("{COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"))], Json(json!({ "ok": true }))).into_response()
}

pub async fn require(State(s): State<Shared>, req: Request, next: Next) -> Response {
    if !origin_ok(req.headers(), req.uri()) {
        return (StatusCode::FORBIDDEN, "cross-origin request refused").into_response();
    }
    if s.auth.session_from(req.headers()).is_none() {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "locked" }))).into_response();
    }
    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn h(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        let mut m = HeaderMap::new();
        for (k, v) in pairs {
            m.insert(*k, HeaderValue::from_static(v));
        }
        m
    }

    #[test]
    fn same_origin_over_http1_and_http2() {
        let path: Uri = "/api/login".parse().unwrap();
        let h2: Uri = "https://pear.example.com:9091/api/login".parse().unwrap();
        assert!(origin_ok(&h(&[("origin", "https://pear.example.com:9091"), ("host", "pear.example.com:9091")]), &path));
        assert!(origin_ok(&h(&[("origin", "https://pear.example.com:9091")]), &h2));
        assert!(origin_ok(&h(&[("origin", "https://Pear.Example.com")]), &"https://pear.example.com:443/x".parse().unwrap()));
        assert!(origin_ok(&h(&[("host", "x")]), &path));
    }

    #[test]
    fn refuses_cross_origin() {
        let path: Uri = "/api/login".parse().unwrap();
        let h2: Uri = "https://pear.example.com:9091/api/login".parse().unwrap();
        assert!(!origin_ok(&h(&[("origin", "https://evil.example"), ("host", "pear.example.com:9091")]), &path));
        assert!(!origin_ok(&h(&[("origin", "https://evil.example")]), &h2));
        assert!(!origin_ok(&h(&[("origin", "https://pear.example.com:9092")]), &h2));
        assert!(!origin_ok(&h(&[("origin", "null"), ("host", "pear.example.com")]), &path));
        assert!(!origin_ok(&h(&[("origin", "https://pear.example.com")]), &path));
    }
}
