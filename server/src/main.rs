mod auth;
mod files;
mod proxy;
mod pty;
mod sys;
mod tls;
mod ui;

use std::{net::SocketAddr, path::PathBuf, sync::Arc};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderValue, header},
    middleware,
    routing::{any, get, post, put},
};
use clap::Parser;
use serde_json::json;

#[derive(Parser, Clone)]
#[command(name = "pearosd", version, about = "The PearOS compute backend. EC2, but worse.")]
pub struct Args {
    #[arg(long, env = "PEAROS_PASSWORD", hide_env_values = true, help = "Login password (prefer the env var; flags show up in `ps`)")]
    password: Option<String>,
    #[arg(long, default_value = "0.0.0.0:9091", help = "Address and port to listen on")]
    bind: SocketAddr,
    #[arg(long, env = "PEAROS_ROOT", help = "Folder served as PearDrive [default: ~/PearDrive]")]
    root: Option<PathBuf>,
    #[arg(long, requires = "key", help = "TLS certificate (PEM). Without it a self-signed one is generated")]
    cert: Option<PathBuf>,
    #[arg(long, requires = "cert", help = "TLS private key (PEM) for --cert")]
    key: Option<PathBuf>,
    #[arg(long, help = "Serve plain HTTP (only behind a TLS-terminating proxy or on localhost)")]
    no_tls: bool,
    #[arg(long, help = "Let the web proxy reach private, loopback and link-local addresses")]
    allow_private: bool,
    #[arg(long, hide = true)]
    api_only: bool,
}

pub struct AppState {
    pub auth: auth::Auth,
    pub root: PathBuf,
    pub sys: std::sync::Mutex<sysinfo::System>,
    pub proxy: proxy::Proxy,
    pub secure: bool,
}

pub type Shared = Arc<AppState>;

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

#[tokio::main]
async fn main() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let args = Args::parse();

    let root = args.root.clone().unwrap_or_else(|| home().join("PearDrive"));
    if let Err(e) = std::fs::create_dir_all(&root) {
        eprintln!("pearosd: can't create {}: {e}", root.display());
        std::process::exit(1);
    }
    let root = root.canonicalize().expect("canonical root");
    files::seed(&root);

    let (password, generated) = match args.password.clone().filter(|p| !p.is_empty()) {
        Some(p) => (p, false),
        None => (auth::random_password(), true),
    };

    let state: Shared = Arc::new(AppState {
        auth: auth::Auth::new(&password),
        root: root.clone(),
        sys: std::sync::Mutex::new(sysinfo::System::new_all().expect("sysinfo")),
        proxy: proxy::Proxy::new(args.allow_private),
        secure: !args.no_tls,
    });

    let protected = Router::new()
        .route("/api/fs/list", get(files::list))
        .route("/api/fs/read", get(files::read))
        .route("/api/fs/write", put(files::write).layer(DefaultBodyLimit::disable()))
        .route("/api/fs/mkdir", post(files::mkdir))
        .route("/api/fs/rename", post(files::rename))
        .route("/api/fs/trash", post(files::trash))
        .route("/api/fs/delete", post(files::delete))
        .route("/api/sys", get(sys::info))
        .route("/api/procs", get(sys::procs))
        .route("/api/procs/kill", post(sys::kill))
        .route("/api/pty", get(pty::ws))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::require));

    let mut app = Router::new()
        .route("/api/health", get(health))
        .route("/api/login", post(auth::login))
        .route("/api/logout", post(auth::logout))
        .merge(protected)
        .route("/p/{token}/{*rest}", any(proxy::handle));
    if !args.api_only {
        app = app.fallback(ui::serve);
    }
    let app = app.layer(middleware::map_response(security_headers)).with_state(state).into_make_service_with_connect_info::<SocketAddr>();

    let scheme = if args.no_tls { "http" } else { "https" };
    let shown = if args.bind.ip().is_unspecified() { format!("{scheme}://localhost:{}", args.bind.port()) } else { format!("{scheme}://{}", args.bind) };
    println!("\n  pearosd {} — EC2, but worse\n", env!("CARGO_PKG_VERSION"));
    println!("  PearDrive  {}", root.display());
    println!("  Listening  {shown}  (bound to {})", args.bind);
    if generated {
        println!("  Password   {password}   (generated; set PEAROS_PASSWORD to choose one)");
    }
    println!("  Proxy      {}", if args.allow_private { "public + private networks" } else { "public internet only" });
    println!("\n  Anyone with the password gets a shell as {}.\n", current_user());

    if args.no_tls {
        axum_server::bind(args.bind).serve(app).await.expect("server");
    } else {
        let config = tls::config(&args).await;
        if args.cert.is_none() {
            println!("  TLS        self-signed (your browser will warn once; --cert/--key for a real one)\n");
        }
        axum_server::bind_rustls(args.bind, config).serve(app).await.expect("server");
    }
}

async fn health(State(s): State<Shared>, headers: axum::http::HeaderMap) -> Json<serde_json::Value> {
    let session = s.auth.session_from(&headers);
    Json(json!({
        "pearosd": true,
        "version": env!("CARGO_PKG_VERSION"),
        "authed": session.is_some(),
        "proxyToken": session.map(|x| x.proxy_token),
    }))
}

async fn security_headers(mut res: axum::response::Response) -> axum::response::Response {
    let h = res.headers_mut();
    if !h.contains_key("x-pearos-proxied") {
        h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("SAMEORIGIN"));
        h.insert("cross-origin-opener-policy", HeaderValue::from_static("same-origin"));
    }
    h.remove("x-pearos-proxied");
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    res
}

pub fn current_user() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("LOGNAME"))
        .ok()
        .or_else(|| std::process::Command::new("id").arg("-un").output().ok().and_then(|o| String::from_utf8(o.stdout).ok()).map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "this user".into())
}
