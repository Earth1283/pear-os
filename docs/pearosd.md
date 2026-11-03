# Setting up pearosd

`pearosd` is the optional backend for PearOS. It's one binary that serves the PearOS UI and gives it a real machine behind the parody:

| PearOS app | With pearosd |
| --- | --- |
| Lock screen | Checks a real password |
| Terminal | A real login shell on the server |
| Finder → PearDrive | A real folder on the server: upload, download, rename, trash |
| TextEdit | Opens and saves real text files from PearDrive |
| Activity Monitor | The server's real processes; you can quit ones owned by the same user |
| About This Pear | The server's real hostname, CPU, cores and RAM |
| Sapphari | Browses the real web through a rewriting proxy on the server |

The copy on GitHub Pages never talks to a backend. To use these features, open the page that `pearosd` itself serves.

> [!WARNING]
> Anyone who knows the password gets a shell as the user running `pearosd`. Treat the password like an SSH key, and run the server as a dedicated unprivileged user (see [Run it as a service](#run-it-as-a-service)) or inside a container.

## Quick start

Download the latest build from the [`nightly` release](https://github.com/Earth1283/pear-os/releases/tag/nightly), or a versioned one from [Releases](https://github.com/Earth1283/pear-os/releases).

| Archive | For |
| --- | --- |
| `pearosd-linux-x86_64.tar.gz` | Linux on x86_64. Static, so it runs on any distro |
| `pearosd-linux-arm64.tar.gz` | Linux on ARM64 (Raspberry Pi 4/5, Graviton, Ampere). Static |
| `pearosd-macos-arm64.tar.gz` | macOS on Apple Silicon |
| `pearosd-macos-x86_64.tar.gz` | macOS on Intel |

```sh
curl -LO https://github.com/Earth1283/pear-os/releases/download/nightly/pearosd-linux-x86_64.tar.gz
curl -LO https://github.com/Earth1283/pear-os/releases/download/nightly/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
tar xzf pearosd-linux-x86_64.tar.gz

PEAROS_PASSWORD='pick something long' ./pearosd-linux-x86_64
```

Then open `https://<server>:9091`. The first time, your browser warns about the certificate (see [TLS](#tls)). Accept it, press the power button, and log in with your password.

The macOS binaries aren't signed. If macOS refuses to open one, run `xattr -d com.apple.quarantine ./pearosd-macos-*`.

If you don't set a password, `pearosd` generates one and prints it at startup:

```
  pearosd 0.1.0 — EC2, but worse

  PearDrive  /home/you/PearDrive
  Listening  https://localhost:9091  (bound to 0.0.0.0:9091)
  Password   leaf-juicy-ripe-crisp-stem-37d334e2   (generated; set PEAROS_PASSWORD to choose one)
  Proxy      public internet only

  Anyone with the password gets a shell as you.

  TLS        self-signed (your browser will warn once; --cert/--key for a real one)
```

A generated password changes on every restart. Set `PEAROS_PASSWORD` for one that stays the same.

## Options

```
Usage: pearosd [OPTIONS]

      --password <PASSWORD>  Login password (prefer the env var; flags show up in `ps`) [env: PEAROS_PASSWORD]
      --bind <BIND>          Address and port to listen on [default: 0.0.0.0:9091]
      --root <ROOT>          Folder served as PearDrive [default: ~/PearDrive] [env: PEAROS_ROOT=]
      --cert <CERT>          TLS certificate (PEM). Without it a self-signed one is generated
      --key <KEY>            TLS private key (PEM) for --cert
      --no-tls               Serve plain HTTP (only behind a TLS-terminating proxy or on localhost)
      --allow-private        Let the web proxy reach private, loopback and link-local addresses
```

- **Password:** pass it with `PEAROS_PASSWORD`, not `--password`. Command-line flags are visible to every user on the machine through `ps`.
- **PearDrive:** created if it doesn't exist. If it's empty, it gets a welcome file and a `Documents` folder.
- **Shell:** Terminal starts the user's `$SHELL` as a login shell (`-l`), falling back to `zsh`, `bash`, then `sh`. It starts in the PearDrive folder with `TERM=xterm-256color`.

## Pick how people reach it

| Setup | Flags | Good for |
| --- | --- | --- |
| Built-in self-signed HTTPS | (none) | Trying it out, home networks |
| Your own certificate | `--cert` / `--key` | You already have a certificate the service user can read |
| Behind Caddy or nginx | `--no-tls --bind 127.0.0.1:9091` | A real domain on the public internet (recommended) |
| Tailscale | `--no-tls --bind 127.0.0.1:9091` | Only your own devices |
| SSH tunnel | `--bind 127.0.0.1:9091` | Nothing exposed at all |

Never run `--no-tls` on a public address. The password and session cookie would travel in plain text.

### TLS

With no flags, `pearosd` creates a self-signed certificate on first run. It's stored in `$XDG_CONFIG_HOME/pearosd/` (usually `~/.config/pearosd/cert.pem` and `key.pem`) and reused after that, so you only accept the browser warning once per browser. The certificate covers `localhost`, `127.0.0.1`, `::1`, the machine's hostname, and the `--bind` address if it's a specific IP. Delete both files to generate a new pair.

Some browsers, Safari in particular, may refuse the terminal's WebSocket connection to a self-signed server even after you accept the page. If Terminal never connects, use a real certificate or put a reverse proxy in front.

### Behind Caddy (recommended)

Caddy gets a Let's Encrypt certificate automatically and handles WebSockets and large uploads without extra configuration:

```sh
PEAROS_PASSWORD='…' pearosd --no-tls --bind 127.0.0.1:9091
```

```caddyfile
pear.example.com {
	reverse_proxy 127.0.0.1:9091
}
```

### Behind nginx

The two settings that matter are passing the WebSocket upgrade (or Terminal won't connect) and passing the original `Host` header, port included (or every request is rejected as cross-origin).

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    http2 on;
    server_name pear.example.com;

    ssl_certificate     /etc/letsencrypt/live/pear.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pear.example.com/privkey.pem;

    client_max_body_size 0;

    location / {
        proxy_pass http://127.0.0.1:9091;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 1d;
        proxy_buffering off;
        proxy_request_buffering off;
    }
}
```

- **`client_max_body_size 0`** lets you upload files of any size to PearDrive.
- **`proxy_read_timeout 1d`** keeps idle terminals connected.
- **`proxy_buffering off`** and **`proxy_request_buffering off`** stream downloads and uploads instead of buffering them on disk.

### Tailscale

```sh
PEAROS_PASSWORD='…' pearosd --no-tls --bind 127.0.0.1:9091
sudo tailscale serve --bg 9091
```

This gives you `https://<machine>.<tailnet>.ts.net` with a real certificate, reachable only from your tailnet.

### SSH tunnel

```sh
# on the server
PEAROS_PASSWORD='…' pearosd --bind 127.0.0.1:9091

# on your computer
ssh -N -L 9091:127.0.0.1:9091 you@server
```

Then open `https://localhost:9091`.

## Run it as a service

This runs `pearosd` under systemd as a dedicated `pearos` user, whose home and PearDrive live in `/var/lib/pearos`. The hardening options mean that whoever logs in can only write to that folder and `/tmp`, and can't use `sudo`.

```sh
sudo install -m 755 pearosd-linux-x86_64 /usr/local/bin/pearosd
sudo useradd --system --user-group --home-dir /var/lib/pearos --shell /bin/bash pearos

sudo install -d -m 700 /etc/pearos
echo "PEAROS_PASSWORD=$(openssl rand -base64 24)" | sudo tee /etc/pearos/pearosd.env >/dev/null
sudo chmod 600 /etc/pearos/pearosd.env
sudo cat /etc/pearos/pearosd.env
```

Create `/etc/systemd/system/pearosd.service`:

```ini
[Unit]
Description=PearOS compute backend
After=network-online.target
Wants=network-online.target

[Service]
User=pearos
Group=pearos
EnvironmentFile=/etc/pearos/pearosd.env
ExecStart=/usr/local/bin/pearosd --bind 0.0.0.0:9091
Restart=on-failure

StateDirectory=pearos
WorkingDirectory=/var/lib/pearos
NoNewPrivileges=true
ProtectSystem=strict
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

MemoryMax=2G
CPUQuota=200%
TasksMax=512

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now pearosd
journalctl -u pearosd -f
```

- **`StateDirectory=pearos`** creates `/var/lib/pearos`, owned by `pearos`. It's the only writable place besides `/tmp`. With the default settings, PearDrive ends up at `/var/lib/pearos/PearDrive` and the self-signed certificate at `/var/lib/pearos/.config/pearosd/`.
- **`NoNewPrivileges=true`** stops the shell from gaining privileges through `sudo` or setuid binaries.
- **`MemoryMax`, `CPUQuota` and `TasksMax`** cap what people can run in the terminal, so a runaway build or fork bomb can't take the whole server down. Adjust them to your machine.
- **Stopping the service** also kills every shell it started.
- **Behind a reverse proxy,** change `ExecStart` to `--no-tls --bind 127.0.0.1:9091`.

To update, replace `/usr/local/bin/pearosd` and run `sudo systemctl restart pearosd`. Sessions are kept in memory, so a restart logs everyone out.

## Run it in a container

A container is the strongest isolation option: the shell can only see what you mount. The Linux builds are static, so any small image with a shell works:

```dockerfile
FROM debian:stable-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends bash ca-certificates curl git vim-tiny htop procps \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --shell /bin/bash pear
COPY pearosd-linux-x86_64 /usr/local/bin/pearosd
USER pear
WORKDIR /home/pear
EXPOSE 9091
CMD ["pearosd"]
```

```sh
docker build -t pearosd .
docker run -d --name pearosd -p 9091:9091 \
  -e PEAROS_PASSWORD='…' \
  -v pearos-home:/home/pear \
  --memory 2g --cpus 2 --pids-limit 512 \
  pearosd
```

The named volume keeps PearDrive, the shell history and the self-signed certificate across container rebuilds.

## Security model

- **Password:** hashed with Argon2id in memory at startup. The plain password is never stored.
- **Login rate limit:** 8 attempts per 5 minutes per client IP. Behind a reverse proxy every request comes from the proxy's IP, so the limit is shared by everyone. A string of failed attempts can lock you out for 5 minutes, and restarting the service clears it.
- **Sessions:**
  - A random 256-bit token in an `HttpOnly; SameSite=Strict` cookie, also marked `Secure` when TLS is on. Sessions last 7 days.
  - Lock Screen and Log Out end the session on the server.
- **Cross-site requests:** every API call and WebSocket must come from the same origin the page was loaded from. Requests from other origins, including the Sapphari sandbox, are refused.
- **PearDrive:** paths are resolved inside the PearDrive folder, and anything that escapes it through `..` or symlinks is refused. Note that this only limits Finder; the Terminal can reach whatever the service user can.
- **Processes:** Activity Monitor can only signal processes owned by the same user as `pearosd`, and never `pearosd` itself.
- **Web proxy:**
  - Blocks private, loopback, link-local, CGNAT and cloud-metadata addresses, both IP literals and hostnames that resolve to them, unless you pass `--allow-private`.
  - Proxied pages are served with `Content-Security-Policy: sandbox` and shown in a sandboxed iframe, so they get an opaque origin. They authenticate with a per-session URL token, never the login cookie, so a website you open in Sapphari can't reach the shell or file APIs.
  - Remote cookies are kept on the server and shared by all sessions.

## What the web proxy can and can't do

Sapphari fetches pages on the server, rewrites every link, script, stylesheet and image to go back through `pearosd`, and patches `fetch` and `XMLHttpRequest` inside the page.

- **Works well:** server-rendered sites (Wikipedia, Hacker News, docs, blogs, most news sites, old.reddit.com, DuckDuckGo's HTML version).
- **Partly works:** heavy single-page apps. Navigation done with `location.href = …` can escape the rewriting, and the sandbox has no `localStorage`.
- **Doesn't work:**
  - Sites with bot challenges or strict login flows (Google sign-in, Cloudflare challenges).
  - Service workers and WebRTC.
  - Most video streaming.

Searches typed into the address bar go to DuckDuckGo's HTML version.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| The login screen says "Touch ID or Enter Password" and accepts anything | The page can't reach `/api/health`, so it's in parody mode. You're probably on the GitHub Pages copy, which never talks to a backend; open the address `pearosd` serves instead. |
| Every action fails with `403 cross-origin request refused` | A reverse proxy is changing the `Host` header. In nginx use `proxy_set_header Host $http_host;`. |
| Terminal says `[Process completed]` immediately or never connects | The WebSocket isn't getting through. Add the `Upgrade`/`Connection` headers (nginx), or switch from a self-signed certificate to a real one (Safari). |
| Terminal disconnects after about a minute idle | The reverse proxy's read timeout. Raise `proxy_read_timeout`. |
| "Too many attempts. Try again in a few minutes." | The login rate limit. Wait 5 minutes or restart `pearosd`. |
| Logged out after updating or restarting | Sessions live in memory. Log in again. |
| Sapphari shows "Blocked by PearOS" | The site is on a private network. Start with `--allow-private` if you trust everyone who has the password. |
| Large uploads fail behind nginx | Set `client_max_body_size 0;`. |
| `Address already in use` | Something else is on port 9091. Pick another with `--bind 0.0.0.0:9443`. |
| macOS: "cannot be opened because the developer cannot be verified" | Run `xattr -d com.apple.quarantine ./pearosd-macos-*`. |

## Building from source

You need Node 22+ and a recent stable Rust (edition 2024).

```sh
npm ci
npm run server          # builds the UI, then server/target/release/pearosd with the UI embedded
npm run test:server
```

For development, run the API on its own and let Vite proxy to it:

```sh
npm run server:dev      # API only, plain HTTP on 127.0.0.1:9092
npm run dev             # UI on :9091; proxies /api and /p/ to the server
```

## API

Everything is under `/api` and needs the session cookie, except `health`, `login` and `logout`. Requests must come from the same origin.

| Method | Path | Body or query | Returns |
| --- | --- | --- | --- |
| GET | `/api/health` | | `{ pearosd, version, authed, proxyToken }` |
| POST | `/api/login` | `{ password }` | Sets the session cookie; `{ ok, proxyToken }` |
| POST | `/api/logout` | | Clears the session |
| GET | `/api/fs/list` | `?path=/Documents` | `[{ name, dir, size, modified }]` |
| GET | `/api/fs/read` | `?path=…&download=true` | File contents (served with `CSP: sandbox`) |
| PUT | `/api/fs/write` | `?path=…`, raw body | Streams to a temp file, then renames it into place |
| POST | `/api/fs/mkdir` | `{ path }` | |
| POST | `/api/fs/rename` | `{ from, to }` | |
| POST | `/api/fs/trash` | `{ path }` | Moves it to `.Trash` inside PearDrive |
| POST | `/api/fs/delete` | `{ path }` | Deletes it permanently |
| GET | `/api/sys` | | Hostname, OS, kernel, CPU, memory, disk, uptime, load |
| GET | `/api/procs` | | The top 200 processes by CPU |
| POST | `/api/procs/kill` | `{ pid, force }` | SIGTERM, or SIGKILL if `force` is set |
| GET (WS) | `/api/pty` | `?cols=&rows=` | Binary frames carry terminal data both ways; text frame `{"type":"resize","cols","rows"}` resizes |
| ANY | `/p/{proxyToken}/{http\|https}/{host}/{path}` | | The proxied page |
