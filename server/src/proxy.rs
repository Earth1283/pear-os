use std::{
    cell::{Cell, RefCell},
    net::{IpAddr, SocketAddr},
    rc::Rc,
    sync::Arc,
    time::Duration,
};

use axum::{
    body::Body,
    extract::{Path, Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use lol_html::{RewriteStrSettings, element, html_content::ContentType, rewrite_str, text};
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use url::{Host, Url};

use crate::Shared;

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const SANDBOX: &str = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads";

pub struct Proxy {
    client: reqwest::Client,
    allow_private: bool,
}

fn blocked(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            v.is_private() || v.is_loopback() || v.is_link_local() || v.is_unspecified() || v.is_broadcast() || v.is_multicast() || o[0] == 0 || (o[0] == 100 && (o[1] & 0xc0) == 64) || (o[0] == 198 && (o[1] & 0xfe) == 18)
        }
        IpAddr::V6(v) => {
            let s = v.segments();
            v.is_loopback() || v.is_unspecified() || v.is_multicast() || (s[0] & 0xfe00) == 0xfc00 || (s[0] & 0xffc0) == 0xfe80 || v.to_ipv4_mapped().is_some_and(|m| blocked(IpAddr::V4(m)))
        }
    }
}

struct SafeResolver {
    allow_private: bool,
}

impl Resolve for SafeResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let allow = self.allow_private;
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0)).await?.filter(|a| allow || !blocked(a.ip())).collect();
            if addrs.is_empty() {
                return Err(format!("{host} only resolves to private addresses, which the proxy blocks (start pearosd with --allow-private to allow)").into());
            }
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

impl Proxy {
    pub fn new(allow_private: bool) -> Self {
        let client = reqwest::Client::builder()
            .user_agent(UA)
            .cookie_store(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(45))
            .dns_resolver(Arc::new(SafeResolver { allow_private }))
            .build()
            .expect("http client");
        Self { client, allow_private }
    }

    fn literal_blocked(&self, url: &Url) -> bool {
        if self.allow_private {
            return false;
        }
        match url.host() {
            Some(Host::Ipv4(ip)) => blocked(IpAddr::V4(ip)),
            Some(Host::Ipv6(ip)) => blocked(IpAddr::V6(ip)),
            Some(Host::Domain(d)) => {
                let d = d.to_ascii_lowercase();
                d == "localhost" || d.ends_with(".localhost") || d.ends_with(".local") || d.ends_with(".internal")
            }
            None => true,
        }
    }
}

pub fn proxied(u: &Url, token: &str) -> String {
    match (u.scheme(), u.host_str()) {
        ("http" | "https", Some(host)) => {
            let port = u.port().map(|p| format!(":{p}")).unwrap_or_default();
            let query = u.query().map(|q| format!("?{q}")).unwrap_or_default();
            let frag = u.fragment().map(|f| format!("#{f}")).unwrap_or_default();
            format!("/p/{token}/{}/{host}{port}{}{query}{frag}", u.scheme(), u.path())
        }
        _ => u.to_string(),
    }
}

fn proxify(base: &Url, raw: &str, token: &str) -> Option<String> {
    let raw = raw.trim();
    let lower = raw.to_ascii_lowercase();
    if raw.is_empty() || raw.starts_with('#') || ["data:", "javascript:", "mailto:", "tel:", "blob:", "about:", "sms:"].iter().any(|p| lower.starts_with(p)) {
        return None;
    }
    if raw.starts_with(&format!("/p/{token}/")) {
        return None;
    }
    base.join(raw).ok().map(|u| proxied(&u, token))
}

fn rewrite_srcset(base: &Url, v: &str, token: &str) -> String {
    v.split(',')
        .map(|part| {
            let part = part.trim();
            let (url, desc) = part.split_once(char::is_whitespace).unwrap_or((part, ""));
            let url = proxify(base, url, token).unwrap_or_else(|| url.to_string());
            if desc.is_empty() { url } else { format!("{url} {}", desc.trim()) }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

pub fn rewrite_css(css: &str, base: &Url, token: &str) -> String {
    let mut out = String::with_capacity(css.len() + 256);
    let mut rest = css;
    loop {
        let url_at = rest.find("url(");
        let imp_at = rest.find("@import");
        let next = match (url_at, imp_at) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (None, None) => break,
        };
        if Some(next) == url_at {
            out.push_str(&rest[..next + 4]);
            rest = &rest[next + 4..];
            let Some(end) = rest.find(')') else { break };
            let inner = rest[..end].trim();
            let (q, raw) = match inner.chars().next() {
                Some(c @ ('"' | '\'')) => (c.to_string(), inner.trim_matches(c)),
                _ => (String::new(), inner),
            };
            match proxify(base, raw, token) {
                Some(u) => out.push_str(&format!("{q}{u}{q}")),
                None => out.push_str(&rest[..end]),
            }
            rest = &rest[end..];
        } else {
            out.push_str(&rest[..next + 7]);
            rest = &rest[next + 7..];
            let trimmed = rest.trim_start();
            let ws = rest.len() - trimmed.len();
            if let Some(q @ ('"' | '\'')) = trimmed.chars().next() {
                if let Some(end) = trimmed[1..].find(q) {
                    let raw = &trimmed[1..1 + end];
                    out.push_str(&rest[..ws]);
                    out.push_str(&format!("{q}{}{q}", proxify(base, raw, token).unwrap_or_else(|| raw.to_string())));
                    rest = &trimmed[end + 2..];
                }
            }
        }
    }
    out.push_str(rest);
    out
}

fn js_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_default().replace('<', "\\u003c")
}

fn shim(page: &Url, token: &str) -> String {
    format!(
        r#"<script>(()=>{{const T="/p/"+{token}+"/",B=new URL({page});
const P=u=>{{try{{if(u==null)return u;const s=String(u);if(s.startsWith(T)||/^(data|blob|javascript|about|mailto|tel):/i.test(s))return s;const x=new URL(s,B);if(!/^https?:$/.test(x.protocol))return s;return T+x.protocol.slice(0,-1)+"/"+x.host+x.pathname+x.search+x.hash}}catch(e){{return u}}}};
const F=window.fetch;window.fetch=function(i,o){{return F.call(this,i instanceof Request?new Request(P(i.url),i):P(i),o)}};
const X=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,...r){{return X.call(this,m,P(u),...r)}};
const W=window.open;window.open=function(u,...r){{return W.call(this,u&&P(u),...r)}};
for(const[C,a]of[[HTMLImageElement,"src"],[HTMLScriptElement,"src"],[HTMLLinkElement,"href"],[HTMLIFrameElement,"src"],[HTMLSourceElement,"src"],[HTMLMediaElement,"src"],[HTMLFormElement,"action"]]){{const d=Object.getOwnPropertyDescriptor(C.prototype,a);if(d&&d.set)Object.defineProperty(C.prototype,a,{{...d,set(v){{d.set.call(this,P(v))}}}})}}
const S=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){{return S.call(this,n,/^(src|href|action|poster)$/i.test(n)?P(v):v)}};
for(const k of["pushState","replaceState"]){{const o=history[k];history[k]=function(s,t,u){{try{{return o.call(this,s,t,u==null?u:P(u))}}catch(e){{}}}}}}
const N=()=>parent.postMessage({{pearos:"nav",url:B.href,title:document.title}},"*");N();addEventListener("DOMContentLoaded",N);addEventListener("load",N)}})();</script>"#,
        token = js_str(token),
        page = js_str(page.as_str()),
    )
}

macro_rules! rw_attr {
    ($sel:expr, $attr:expr, $base:ident, $token:ident) => {{
        let b = $base.clone();
        let t = $token.to_string();
        element!($sel, move |el| {
            if let Some(v) = el.get_attribute($attr) {
                if let Some(n) = proxify(&b.borrow(), &v, &t) {
                    el.set_attribute($attr, &n)?;
                }
            }
            Ok(())
        })
    }};
}

macro_rules! rw_srcset {
    ($sel:expr, $base:ident, $token:ident) => {{
        let b = $base.clone();
        let t = $token.to_string();
        element!($sel, move |el| {
            if let Some(v) = el.get_attribute("srcset") {
                el.set_attribute("srcset", &rewrite_srcset(&b.borrow(), &v, &t))?;
            }
            Ok(())
        })
    }};
}

fn rewrite_html(html: &str, page: &Url, token: &str) -> String {
    let base = Rc::new(RefCell::new(page.clone()));
    let injected = Rc::new(Cell::new(false));
    let css_buf = Rc::new(RefCell::new(String::new()));
    let script = shim(page, token);

    let (b1, b2, b3, b4, b5) = (base.clone(), base.clone(), base.clone(), base.clone(), base.clone());
    let (t1, t2, t3, t4) = (token.to_string(), token.to_string(), token.to_string(), token.to_string());
    let inj = injected.clone();
    let page_for_base = page.clone();

    let handlers = vec![
            element!("base[href]", move |el| {
                if let Some(h) = el.get_attribute("href").and_then(|h| page_for_base.join(&h).ok()) {
                    *b1.borrow_mut() = h;
                }
                el.remove();
                Ok(())
            }),
            element!("head", move |el| {
                if !inj.get() {
                    el.prepend(&script, ContentType::Html);
                    inj.set(true);
                }
                Ok(())
            }),
            rw_attr!("a[href]", "href", base, token),
            rw_attr!("area[href]", "href", base, token),
            rw_attr!("link[href]", "href", base, token),
            rw_attr!("script[src]", "src", base, token),
            rw_attr!("img[src]", "src", base, token),
            rw_attr!("img[data-src]", "data-src", base, token),
            rw_attr!("iframe[src]", "src", base, token),
            rw_attr!("frame[src]", "src", base, token),
            rw_attr!("source[src]", "src", base, token),
            rw_attr!("video[src]", "src", base, token),
            rw_attr!("video[poster]", "poster", base, token),
            rw_attr!("audio[src]", "src", base, token),
            rw_attr!("track[src]", "src", base, token),
            rw_attr!("embed[src]", "src", base, token),
            rw_attr!("input[src]", "src", base, token),
            rw_attr!("object[data]", "data", base, token),
            rw_attr!("form[action]", "action", base, token),
            rw_srcset!("img[srcset]", base, token),
            rw_srcset!("source[srcset]", base, token),
            element!("form", move |el| {
                if el.get_attribute("action").is_none() {
                    el.set_attribute("action", &proxied(&b2.borrow(), &t1))?;
                }
                Ok(())
            }),
            element!("[integrity]", |el| {
                el.remove_attribute("integrity");
                Ok(())
            }),
            element!("[target]", |el| {
                if matches!(el.get_attribute("target").as_deref(), Some("_top" | "_parent")) {
                    el.set_attribute("target", "_self")?;
                }
                Ok(())
            }),
            element!("[style]", move |el| {
                if let Some(v) = el.get_attribute("style") {
                    el.set_attribute("style", &rewrite_css(&v, &b3.borrow(), &t2))?;
                }
                Ok(())
            }),
            element!("meta[http-equiv]", move |el| {
                let kind = el.get_attribute("http-equiv").unwrap_or_default().to_ascii_lowercase();
                if kind.starts_with("content-security-policy") || kind == "x-frame-options" {
                    el.remove();
                } else if kind == "refresh" {
                    if let Some(c) = el.get_attribute("content") {
                        if let Some((delay, target)) = c.split_once(';') {
                            let target = target.trim().trim_start_matches(|ch: char| ch.eq_ignore_ascii_case(&'u') || ch.eq_ignore_ascii_case(&'r') || ch.eq_ignore_ascii_case(&'l')).trim_start_matches('=').trim_matches(|ch| ch == '\'' || ch == '"');
                            if let Some(p) = proxify(&b4.borrow(), target, &t3) {
                                el.set_attribute("content", &format!("{delay};url={p}"))?;
                            }
                        }
                    }
                }
                Ok(())
            }),
            text!("style", move |chunk| {
                css_buf.borrow_mut().push_str(chunk.as_str());
                if chunk.last_in_text_node() {
                    let css = std::mem::take(&mut *css_buf.borrow_mut());
                    chunk.replace(&rewrite_css(&css, &b5.borrow(), &t4), ContentType::Html);
                } else {
                    chunk.remove();
                }
                Ok(())
            }),
        ];
    let mut settings = RewriteStrSettings::new();
    for h in handlers {
        settings = settings.append_element_content_handler(h);
    }

    match rewrite_str(html, settings) {
        Ok(out) if injected.get() => out,
        Ok(out) => format!("{}{out}", shim(page, token)),
        Err(_) => format!("{}{html}", shim(page, token)),
    }
}

fn error_page(code: StatusCode, title: &str, detail: &str, page: Option<&Url>, token: &str) -> Response {
    let shim = page.map(|p| shim(p, token)).unwrap_or_default();
    let esc = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let html = format!(
        r#"<!doctype html><meta charset="utf-8">{shim}<title>{t}</title><style>body{{font:14px -apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif;color:#86868b;display:grid;place-items:center;height:90vh;margin:0;text-align:center}}h1{{font-size:22px;color:#1d1d1f;margin:12px 0 6px}}p{{max-width:460px;line-height:1.45}}@media(prefers-color-scheme:dark){{body{{background:#1e1e1e}}h1{{color:#f5f5f7}}}}</style><div><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg><h1>{t}</h1><p>{d}</p></div>"#,
        t = esc(title),
        d = esc(detail),
    );
    (
        code,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8"), (header::CONTENT_SECURITY_POLICY, SANDBOX), (HeaderName::from_static("x-pearos-proxied"), "1")],
        html,
    )
        .into_response()
}

fn target_from(raw_path: &str, token: &str, query: Option<&str>) -> Option<Url> {
    let rest = raw_path.strip_prefix(&format!("/p/{token}/"))?;
    let (scheme, rest) = rest.split_once('/')?;
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let (host, path) = rest.find('/').map(|i| (&rest[..i], &rest[i..])).unwrap_or((rest, "/"));
    let q = query.map(|q| format!("?{q}")).unwrap_or_default();
    Url::parse(&format!("{scheme}://{host}{path}{q}")).ok()
}

pub async fn handle(State(s): State<Shared>, Path((token, _)): Path<(String, String)>, req: Request) -> Response {
    if !s.auth.proxy_token_valid(&token) {
        return error_page(StatusCode::UNAUTHORIZED, "Proxy session expired", "Log in to PearOS again to keep browsing.", None, &token);
    }
    let Some(target) = target_from(req.uri().path(), &token, req.uri().query()) else {
        return error_page(StatusCode::BAD_REQUEST, "Sapphari Can't Open the Page", "That doesn't look like a web address.", None, &token);
    };
    if s.proxy.literal_blocked(&target) {
        return error_page(
            StatusCode::FORBIDDEN,
            "Blocked by PearOS",
            &format!("{} is a private or local address. pearosd only proxies the public internet unless it's started with --allow-private.", target.host_str().unwrap_or("That")),
            Some(&target),
            &token,
        );
    }

    let method = req.method().clone();
    let mut rb = s.proxy.client.request(method.clone(), target.clone());
    for h in [header::ACCEPT, header::ACCEPT_LANGUAGE, header::CONTENT_TYPE, header::RANGE, header::IF_NONE_MATCH, header::IF_MODIFIED_SINCE] {
        if let Some(v) = req.headers().get(&h) {
            rb = rb.header(h, v);
        }
    }
    if method != Method::GET && method != Method::HEAD {
        match axum::body::to_bytes(req.into_body(), 32 * 1024 * 1024).await {
            Ok(b) => rb = rb.body(b),
            Err(_) => return error_page(StatusCode::PAYLOAD_TOO_LARGE, "Request Too Large", "Uploads through Sapphari are limited to 32 MB.", Some(&target), &token),
        }
    }

    let resp = match rb.send().await {
        Ok(r) => r,
        Err(e) => {
            let mut detail = e.to_string();
            let mut src = std::error::Error::source(&e);
            while let Some(inner) = src {
                detail = inner.to_string();
                src = inner.source();
            }
            return error_page(StatusCode::BAD_GATEWAY, "Sapphari Can't Open the Page", &format!("{}: {detail}", target.host_str().unwrap_or("")), Some(&target), &token);
        }
    };

    let status = resp.status();
    let mut headers = HeaderMap::new();
    for h in [header::CONTENT_TYPE, header::CACHE_CONTROL, header::ETAG, header::LAST_MODIFIED, header::CONTENT_RANGE, header::ACCEPT_RANGES, header::CONTENT_DISPOSITION, header::EXPIRES, header::CONTENT_LANGUAGE] {
        if let Some(v) = resp.headers().get(&h) {
            headers.insert(h, v.clone());
        }
    }
    if status.is_redirection() {
        if let Some(loc) = resp.headers().get(header::LOCATION).and_then(|l| l.to_str().ok()).and_then(|l| target.join(l).ok()) {
            if let Ok(v) = HeaderValue::from_str(&proxied(&loc, &token)) {
                headers.insert(header::LOCATION, v);
            }
        }
    }
    headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(SANDBOX));
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(HeaderName::from_static("x-pearos-proxied"), HeaderValue::from_static("1"));

    let ctype = resp.headers().get(header::CONTENT_TYPE).and_then(|c| c.to_str().ok()).unwrap_or("").to_ascii_lowercase();
    if ctype.starts_with("text/html") || ctype.starts_with("application/xhtml") {
        let html = resp.text().await.unwrap_or_default();
        let out = rewrite_html(&html, &target, &token);
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/html; charset=utf-8"));
        return (status, headers, out).into_response();
    }
    if ctype.starts_with("text/css") {
        let css = resp.text().await.unwrap_or_default();
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/css; charset=utf-8"));
        return (status, headers, rewrite_css(&css, &target, &token)).into_response();
    }
    (status, headers, Body::from_stream(resp.bytes_stream())).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_private() {
        for ip in ["127.0.0.1", "10.1.2.3", "192.168.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "0.0.0.0"] {
            assert!(blocked(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["1.1.1.1", "93.184.216.34", "2606:4700::1111"] {
            assert!(!blocked(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn round_trip() {
        let base = Url::parse("https://example.com/a/b.html?x=1").unwrap();
        assert_eq!(proxify(&base, "c.png", "T").unwrap(), "/p/T/https/example.com/a/c.png");
        assert_eq!(proxify(&base, "/root?q=2#f", "T").unwrap(), "/p/T/https/example.com/root?q=2#f");
        assert_eq!(proxify(&base, "//cdn.x.org:8443/y", "T").unwrap(), "/p/T/https/cdn.x.org:8443/y");
        assert!(proxify(&base, "javascript:alert(1)", "T").is_none());
        let t = target_from("/p/T/https/example.com:8080/a b", "T", Some("q=1")).unwrap();
        assert_eq!(t.as_str(), "https://example.com:8080/a%20b?q=1");
    }

    #[test]
    fn rewrites_css_and_html() {
        let base = Url::parse("https://e.com/css/site.css").unwrap();
        let css = rewrite_css("a{background:url('../i.png')} @import \"x.css\"; b{src:url(data:abc)}", &base, "T");
        assert!(css.contains("url('/p/T/https/e.com/i.png')"), "{css}");
        assert!(css.contains("@import \"/p/T/https/e.com/css/x.css\""), "{css}");
        assert!(css.contains("url(data:abc)"), "{css}");
        let page = Url::parse("https://e.com/dir/").unwrap();
        let html = rewrite_html(r#"<html><head><base href="/other/"><link rel=stylesheet href="s.css" integrity="sha-x"></head><body><a href="p" target="_top">x</a><img srcset="a.png 1x, b.png 2x"><form></form></body></html>"#, &page, "T");
        assert!(html.contains(r#"href="/p/T/https/e.com/other/s.css""#), "{html}");
        assert!(!html.contains("integrity"), "{html}");
        assert!(html.contains(r#"target="_self""#), "{html}");
        assert!(html.contains("/p/T/https/e.com/other/b.png 2x"), "{html}");
        assert!(html.contains("<script>(()=>"), "{html}");
    }
}
