use std::path::PathBuf;

use axum_server::tls_rustls::RustlsConfig;

use crate::Args;

fn config_dir() -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("pearosd")
}

pub async fn config(args: &Args) -> RustlsConfig {
    if let (Some(cert), Some(key)) = (&args.cert, &args.key) {
        return RustlsConfig::from_pem_file(cert, key).await.unwrap_or_else(|e| {
            eprintln!("pearosd: can't load --cert/--key: {e}");
            std::process::exit(1)
        });
    }
    let dir = config_dir();
    let (cert, key) = (dir.join("cert.pem"), dir.join("key.pem"));
    if !cert.exists() || !key.exists() {
        let mut names = vec!["localhost".to_string(), "127.0.0.1".to_string(), "::1".to_string()];
        if let Ok(h) = hostname::get() {
            names.push(h.to_string_lossy().into_owned());
        }
        if !args.bind.ip().is_unspecified() {
            names.push(args.bind.ip().to_string());
        }
        let generated = rcgen::generate_simple_self_signed(names).expect("generate certificate");
        std::fs::create_dir_all(&dir).expect("create config dir");
        std::fs::write(&cert, generated.cert.pem()).expect("write cert");
        std::fs::write(&key, generated.signing_key.serialize_pem()).expect("write key");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o600));
        }
    }
    RustlsConfig::from_pem_file(&cert, &key).await.expect("load generated certificate")
}
