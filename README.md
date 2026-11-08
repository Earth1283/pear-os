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
- **`.github/workflows/release.yml`** runs the tests, then builds `pearosd` for Linux x86_64 and arm64 (static musl). It publishes the builds as follows:
  - **Push to `main`:** force-moves the `nightly` tag and replaces the assets on the **nightly** pre-release.
  - **Push a `v*` tag:** creates a normal versioned release.
  - **Pull request:** builds without publishing.
- **`.github/workflows/macos.yml`** builds `pearosd` for macOS arm64 and x86_64. It only runs on request (Actions, then macOS build, then Run workflow) and uploads the archives as workflow artifacts, not to a release.

One-time setup: Settings → Pages → Source: **GitHub Actions**.

## pearosd: the optional compute backend ("EC2, but worse")

`pearosd` is one Rust binary that serves the UI and turns the parody into a real remote machine:

- **Login:** the lock screen checks a real password (argon2). Sessions use an HttpOnly, SameSite=Strict cookie. Login is rate-limited, and cross-origin requests are refused.
- **PearDrive:** a real folder in Finder. Upload by dragging files in, download, rename, trash, and edit text files in TextEdit. Paths can't escape the folder, including via `..` or symlinks.
- **Music:** plays the audio in PearDrive (`/Music` or anywhere else). Titles, artists, albums and cover art come from the files' ID3 tags. Dropping files onto the Music window uploads them to `/Music`.
- **Terminal:** a real shell on the host (pty plus xterm.js).
- **Activity Monitor:** the host's real processes. You can quit your own.
- **Windows 98 download:** Boot Camp can fetch the Windows 98 SE disc from archive.org through `pearosd` (browsers can't do it directly, because archive.org sends no CORS headers). The endpoint only talks to `https://*.archive.org/download/…`, and keeps a copy in `PearDrive/Downloads`, so only the first install on a server waits for archive.org (`--no-download-cache` to turn that off). See *Windows 98* below.
- **Sapphari:** browses the real web through a rewriting proxy. Pages run in a sandboxed iframe with an opaque origin, so they can't reach the PearOS API. Private, LAN and loopback addresses are blocked unless you pass `--allow-private`.
- **TLS:** HTTPS with a self-signed cert generated on first run (stored in `~/.config/pearosd/`). Use `--cert`/`--key` for a real one, or `--no-tls` behind your own TLS proxy.

```sh
npm run server                       # builds UI, then server/target/release/pearosd with the UI embedded
PEAROS_PASSWORD='something long' ./server/target/release/pearosd
# https://<host>:9091   (flags: --bind, --root, --cert/--key, --no-tls, --allow-private)
```

Anyone with the password gets a shell as the user running pearosd, so run it as an unprivileged user or in a container.

Full setup guide (downloads, reverse proxies, systemd, Docker, troubleshooting): [docs/pearosd.md](docs/pearosd.md).

`npm run server:static` builds a fully static musl binary (needs `zig` for `cargo zigbuild`).

**Development:** run `npm run server:dev` (API on 127.0.0.1:9092) alongside `npm run dev`. Vite proxies `/api` and `/p/` to it.

## Music, widgets and notifications

- **Music** is a full player: Songs, Albums, Artists, Favorites, search, sorting, a live spectrum visualizer, and Media Session support, so your keyboard media keys work. It plays from three places:
  - **PearDrive**, when `pearosd` is running.
  - **This Computer**: drop or add files, which last until you close the tab.
  - **Pear Radio**, ten endless stations synthesised in your browser with WebAudio. There are no samples, so it works on the static GitHub Pages build too. Four are music. Six talk: a numbers station, Pear News Network, Radio Free Kernel (the boot log, read aloud), a marine forecast, LKML Radio (real rants from the kernel mailing list, with the swearing bleeped) and LKML After Dark (the same, unbleeped, with the nastier ones left in). LKML Radio’s text lives in `src/lib/lkml.ts`; dated entries were checked against the list archives. They use the browser's speech synthesis over a quiet bed, with scripts generated on the fly. The voice depends on what your OS has installed, and speech doesn't go through the spectrum visualizer. What's being said shows up as live captions on Music's Now Playing page, and as the current line in the toolbar display, Control Center and the Music widget.
- **Control Center** has a Now Playing card, a working Sound slider and a working Do Not Disturb.
- **Notification Center** opens when you click the clock. It keeps a history of everything that popped up, grouped by app, with widgets underneath. Do Not Disturb holds banners back but still files them here.
- **Widgets**: Clock, Calendar, Weather (forecast by vibes), Activity (real CPU, memory and disk with `pearosd`, simulated without), Music and Notes. Drag them around the desktop, resize them from the right-click menu, and add or remove them with *Edit Widgets…*. Layout is saved in your browser.
- Music stops when you shut down, restart, panic, log out or quit it. It pauses when you sleep, and keeps playing on the lock screen, like the real thing.

## Photo Booth and Mail

- **Photo Booth** uses your real camera (HTTPS or localhost only; browsers insist). 18 effects run as one WebGL2 shader on your GPU: the classics (Bulge, Twirl, Thermal Camera, Pop Art…) and a cursed second page (Corporate Headshot, Low Battery, Video Call 2020, Deep Fried, Witness Protection, Liquid Glass, Security Camera with a burned-in timestamp). Take one photo or four, with a 3-2-1 countdown and flash. Photos are real JPEGs in `~/Pictures/Photo Booth Library` and open in Preview. They last until you close the tab, unless you right-click one and *Save to PearDrive*. The camera turns off when you close the window.
- **Mail** has an inbox. Some of it is real: the sign-in alert names your actual browser, OS and time zone, PearCloud quotes your browser's real storage quota, and Software Update's email names the commit you're running. The Junk folder is decided by `junk_score` in the Rust kernel, and the compose sheet has a live Junk-o-meter for your draft. Pear ID sends a verification code every few minutes. It expires after 30 seconds, for real. *Send* puts mail in the Outbox, where it waits forever (there's no mail server); open it and choose *Send with Your Real Mail App* to hand it to `mailto:`.

## Boot Camp: install Windows 95

Open **Boot Camp Assistant** (Spotlight, Launchpad, or *Applications*). It walks through the real flow: pick an ISO, size the partition, then "download" the support software over a 56k modem (the progress bar stalls at 99% and falls back to 62%). Restart when it asks.

- Once Windows exists, every boot shows a **Startup Manager** (arrow keys, Return, or click). It auto-picks the default disk after 8 seconds.
- First boot runs **Windows 95 Setup**: ScanDisk, a licence agreement, a Product Key (try `111-1111111`), file copying, and a restart. Then comes the Welcome screen, a Start menu, a taskbar, and a desktop full of things that work.
- Windows 95 is a fake: a self-contained React and CSS app in `src/win95/`, with original SVG art and no Microsoft files, so it also runs on the static GitHub Pages build.
- Inside: **Minesweeper** (all three levels, chording), **Paint** (real tools, flood fill, saves a PNG), **Notepad**, **MS-DOS Prompt** (`dir`, `cd`, `type`, `format c:`, `pear`), **My Computer**, **Recycle Bin**, **Control Panel → Display** (recolour the desktop), and **The Pear Network** (dial-up, busy line).
- Start → Run… takes `winmine`, `mspaint`, `command`, `winver`, `explorer`, `bsod`. Ctrl+Alt+Del opens Close Program.
- It will crash on its own, once per boot, a few minutes in. Press any key. That closes your current program, like the real thing.
- Leave through *Start → Shut Down…*: shut down, restart, **restart in MS-DOS mode** (type `win` to come back), or **go back to Pear OS**.
- State (installed or not, startup disk, partition size, Welcome screen) lives in `localStorage`. *Remove Windows 95…* in Boot Camp wipes it.

### Windows 98 (real, via v86)

Boot Camp's second option is the actual Windows 98, running in [v86](https://github.com/copy/v86), an x86 emulator written in Rust and WebAssembly.

- **Get a disc image.** Pear does not ship Windows. Either choose your own ISO in Boot Camp (it is copied into your browser's IndexedDB and never uploaded), or, when running `pearosd`, pick **Download from archive.org** and the server fetches Windows 98 SE (625 MB) for you and streams it into IndexedDB with a real progress bar. On the static GitHub Pages build there is no server, so only your own ISO works. Windows 98 is still copyrighted software: Setup will ask for a product key, and Boot Camp links to the disc's archive.org page, which lists the one for that disc.
- **First run:** the disc opens a startup menu that defaults to *Boot from Hard Disk*, which is empty. Press **2** (Boot from CD-ROM) within 10 seconds, then Enter at Setup's welcome screen.
- **The progress bars are real.** Boot Camp downloads the emulator and its BIOS (`v86.wasm`, `seabios.bin`, `vgabios.bin`, about 2 MB) with streamed byte counts, then copies your ISO in 8 MB chunks with MB/s and an ETA. Both are stored locally, so Windows 98 also starts offline.
- **Setup runs for real,** so expect 30 to 60 minutes. The machine is saved (RAM, CPU and every disk block the guest wrote) every 5 minutes and whenever you press *Return to Pear OS*, and the next boot resumes it. The hard disk is sparse (0.5 to 2 GB, from the partition slider), so a save is tens of MB, not the whole disk.
- **Controls:** click the screen to capture the mouse (Esc releases it). The toolbar has *Ctrl+Alt+Del*, *Save* and *Return to Pear OS*. Shutting down inside Windows 98 stops at "It's now safe to turn off your computer"; use *Return to Pear OS* from there.
- *Remove Windows 98…* in Boot Camp deletes the ISO, the support files and the saved machine.
- BIOS images in `public/v86/` are SeaBIOS and VGABIOS (LGPL, see `COPYING.LESSER` there). v86 is BSD-2-Clause.

## What the Rust kernel does

| Export | Used by |
| --- | --- |
| `calc` | Calculator, Math Notes, Spotlight, `calc` in Terminal |
| `render_mandelbrot` | Fractals app and the Mandelbrot wallpaper |
| `password_strength` | Passwords → Strength Checker |
| `junk_score` | Mail → Junk folder and the compose Junk-o-meter |
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
- Click the clock for Notification Center, then *Edit Widgets*. Right-click the desktop for the same.
- Open Music, hit *Pear Radio*, and try the visualizer. In Terminal, `open music` works too.
- Terminal: `pearfetch`, `pearsay hi`, `ls ~/Downloads`, `open notes`, `sudo rm -rf /`.
- Notes: end a line with `=`.
- Fractals: click to zoom, then "Set as Wallpaper".
- Chess: play Stockfish 19. Losing? Open the *Additional Tools* menu (Tactical Nuke, Orbital Strike, `kill -9 stockfish`, Uno Reverse, and friends).
- Activity Monitor: force quit `kernel_task`.
- Boot Camp Assistant: install Windows 95, restart, and survive Setup. Then beat Minesweeper before the blue screen gets you.
- Right-click anything: files (tags, duplicate, compress), the desktop, dock icons, the dock separator (autohide), window title bars (tiling), and text fields (Writing Tools, Transformations, Speech).

Not affiliated with Apple. All artwork is original SVG.

## Credits

Chess runs [Stockfish.js](https://github.com/nmrugg/stockfish.js) (Stockfish 19, lite single-threaded WASM, GPL-3.0) in a Web Worker. The engine files are in `public/stockfish/` with its `COPYING.txt`. Rules come from [chess.js](https://github.com/jhlywa/chess.js).
