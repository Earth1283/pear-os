use axum::{
    http::{StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../dist"]
struct Ui;

pub async fn serve(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let (file, path) = match Ui::get(path) {
        Some(f) if !path.is_empty() => (f, path),
        _ => match Ui::get("index.html") {
            Some(f) => (f, "index.html"),
            None => return (StatusCode::NOT_FOUND, "UI not built. Run `npm run build` before building pearosd.").into_response(),
        },
    };
    let cache = if path.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
    ([(header::CONTENT_TYPE, file.metadata.mimetype().to_string()), (header::CACHE_CONTROL, cache.to_string())], file.data).into_response()
}
