# PearOS Sequel

A parody of macOS 15 that runs in a browser tab. The UI is React; the "kernel" is Rust compiled to WebAssembly with no JS glue.

## Run it

```sh
npm install
npm run dev        # http://0.0.0.0:9091
```

The compiled kernel (`src/kernel/pearnel.wasm`) is committed, so Rust is only needed if you change it:

```sh
rustup target add wasm32-unknown-unknown
npm run kernel       # rebuilds and copies pearnel.wasm
npm run test:kernel  # parser tests
```

## CI

- **`.github/workflows/pages.yml`** deploys the static parody to GitHub Pages on every push to `main`. That copy has no backend, so it runs in fake mode.
- **`.github/workflows/release.yml`** runs the tests, then builds `pearosd` for:
  - Linux x86_64 and arm64 (static musl)
  - macOS arm64 and x86_64

  It publishes the builds as follows:
  - **Push to `main`:** force-moves the `nightly` tag and replaces the assets on the **nightly** pre-release.
  - **Push a `v*` tag:** creates a normal versioned release.
  - **Pull request:** builds without publishing.

One-time setup: Settings → Pages → Source: **GitHub Actions**.

## pearosd: the optional compute backend ("EC2, but worse")

`pearosd` is one Rust binary that serves the UI and turns the parody into a real remote machine:

- **Login:** the lock screen checks a real password (argon2). Sessions use an HttpOnly, SameSite=Strict cookie. Login is rate-limited, and cross-origin requests are refused.
- **PearDrive:** a real folder in Finder. Upload by dragging files in, download, rename, trash, and edit text files in TextEdit. Paths can't escape the folder, including via `..` or symlinks.
- **Terminal:** a real shell on the host (pty plus xterm.js).
- **Activity Monitor:** the host's real processes. You can quit your own.
- **Sapphari:** browses the real web through a rewriting proxy. Pages run in a sandboxed iframe with an opaque origin, so they can't reach the PearOS API. Private, LAN and loopback addresses are blocked unless you pass `--allow-private`.
- **TLS:** HTTPS with a self-signed cert generated on first run (stored in `~/.config/pearosd/`). Use `--cert`/`--key` for a real one, or `--no-tls` behind your own TLS proxy.

```sh
npm run server                       # builds UI, then server/target/release/pearosd with the UI embedded
PEAROS_PASSWORD='something long' ./server/target/release/pearosd
# https://<host>:9091   (flags: --bind, --root, --cert/--key, --no-tls, --allow-private)
```

Anyone with the password gets a shell as the user running pearosd, so run it as an unprivileged user or in a container.

`npm run server:static` builds a fully static musl binary (needs `zig` for `cargo zigbuild`).

**Development:** run `npm run server:dev` (API on 127.0.0.1:9092) alongside `npm run dev`. Vite proxies `/api` and `/p/` to it.

## What the Rust kernel does

| Export | Used by |
| --- | --- |
| `calc` | Calculator, Math Notes, Spotlight, `calc` in Terminal |
| `render_mandelbrot` | Fractals app and the Mandelbrot wallpaper |
| `password_strength` | Passwords → Strength Checker |
| `kernel_task_cpu`, `entropy` | Activity Monitor |
| `kernel_version_*` | `uname -a`, About |

## What the GPU does

Everything here goes through WebGL2, so it runs on the real GPU of whatever machine is showing the page.

- The Sequel wallpaper is a fragment shader, animated at 30 fps. It pauses in background tabs and is static with reduced motion. If WebGL2 isn't available, it falls back to an SVG.
- Fractals renders on the GPU (float32) until zoom passes float32 precision, then the Rust kernel (f64) takes over. You can force either one.
- About, Settings → Displays and `pearfetch` show your actual GPU name.

## Things to try

- Drag a window to a screen edge to tile it, or hover the green button.
- `Ctrl+Space` for Spotlight, then type `2^64` or `8gb`.
- Terminal: `pearfetch`, `pearsay hi`, `ls ~/Downloads`, `open notes`, `sudo rm -rf /`.
- Notes: end a line with `=`.
- Fractals: click to zoom, then "Set as Wallpaper".
- Activity Monitor: force quit `kernel_task`.
- Right-click anything: files (tags, duplicate, compress), the desktop, dock icons, the dock separator (autohide), window title bars (tiling), and text fields (Writing Tools, Transformations, Speech).

Not affiliated with Apple. All artwork is original SVG.
