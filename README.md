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

## What the Rust kernel does

| Export | Used by |
| --- | --- |
| `calc` | Calculator, Math Notes, Spotlight, `calc` in Terminal |
| `render_mandelbrot` | Fractals app and the Mandelbrot wallpaper |
| `password_strength` | Passwords → Strength Checker |
| `kernel_task_cpu`, `entropy` | Activity Monitor |
| `kernel_version_*` | `uname -a`, About |

## Things to try

- Drag a window to a screen edge to tile it, or hover the green button.
- `Ctrl+Space` for Spotlight, then type `2^64` or `8gb`.
- Terminal: `pearfetch`, `pearsay hi`, `ls ~/Downloads`, `open notes`, `sudo rm -rf /`.
- Notes: end a line with `=`.
- Fractals: click to zoom, then "Set as Wallpaper".
- Activity Monitor: force quit `kernel_task`.

Not affiliated with Apple. All artwork is original SVG.
