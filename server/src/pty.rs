use std::{
    io::{Read, Write},
    path::Path,
};

use axum::{
    extract::{
        Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use serde::Deserialize;

use crate::Shared;

#[derive(Deserialize)]
pub struct Size {
    #[serde(default = "default_cols")]
    cols: u16,
    #[serde(default = "default_rows")]
    rows: u16,
}

fn default_cols() -> u16 {
    80
}
fn default_rows() -> u16 {
    24
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Control {
    Resize { cols: u16, rows: u16 },
}

pub async fn ws(State(s): State<Shared>, Query(size): Query<Size>, upgrade: WebSocketUpgrade) -> Response {
    let root = s.root.clone();
    upgrade.on_upgrade(move |socket| async move {
        if let Err(e) = session(socket, &root, size).await {
            eprintln!("pty session ended: {e}");
        }
    })
}

fn shell() -> String {
    std::env::var("SHELL").ok().filter(|s| Path::new(s).exists()).unwrap_or_else(|| {
        ["/bin/zsh", "/bin/bash", "/bin/sh"].iter().find(|p| Path::new(p).exists()).unwrap_or(&"/bin/sh").to_string()
    })
}

async fn session(socket: WebSocket, root: &Path, size: Size) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let pair = native_pty_system().openpty(PtySize { rows: size.rows.max(2), cols: size.cols.max(10), pixel_width: 0, pixel_height: 0 })?;
    let mut cmd = CommandBuilder::new(shell());
    cmd.arg("-l");
    cmd.cwd(root);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "PearOS_Terminal");
    let mut child = pair.slave.spawn_command(cmd)?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader()?;
    let mut writer = pair.master.take_writer()?;
    let master = pair.master;

    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);
    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    let (mut out, mut inp) = socket.split();
    loop {
        tokio::select! {
            data = rx.recv() => match data {
                Some(d) => out.send(Message::Binary(d.into())).await?,
                None => break,
            },
            msg = inp.next() => match msg {
                Some(Ok(Message::Binary(b))) => writer.write_all(&b)?,
                Some(Ok(Message::Text(t))) => {
                    if let Ok(Control::Resize { cols, rows }) = serde_json::from_str::<Control>(&t) {
                        let _ = master.resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 });
                    } else {
                        writer.write_all(t.as_bytes())?;
                    }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            },
        }
    }
    let _ = child.kill();
    let _ = out.send(Message::Close(None)).await;
    Ok(())
}
