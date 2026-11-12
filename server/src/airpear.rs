//! Discovery and WebRTC signaling only. File bytes never pass through this hub.
use crate::Shared;
use axum::{
    extract::{
        Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use tokio::sync::mpsc;

#[derive(Default)]
pub struct Hub {
    peers: Mutex<HashMap<String, Peer>>,
}
struct Peer {
    name: String,
    tx: mpsc::Sender<String>,
}

#[derive(Deserialize)]
pub struct Registration {
    id: String,
    name: String,
}

fn valid_id(id: &str) -> bool {
    (16..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}

impl Hub {
    fn announce(peers: &HashMap<String, Peer>) {
        let list: Vec<_> = peers
            .iter()
            .map(|(id, peer)| json!({"id": id, "name": peer.name}))
            .collect();
        let message = json!({"type": "peers", "peers": list}).to_string();
        for peer in peers.values() {
            let _ = peer.tx.try_send(message.clone());
        }
    }

    fn register(&self, id: &str, name: &str, tx: mpsc::Sender<String>) -> bool {
        let mut peers = self.peers.lock().unwrap();
        if peers.len() >= 64 || peers.contains_key(id) {
            return false;
        }
        peers.insert(
            id.to_owned(),
            Peer {
                name: name.to_owned(),
                tx,
            },
        );
        Self::announce(&peers);
        true
    }

    fn remove(&self, id: &str) {
        let mut peers = self.peers.lock().unwrap();
        peers.remove(id);
        Self::announce(&peers);
    }

    fn relay(&self, from: &str, text: &str) -> bool {
        let Ok(value) = serde_json::from_str::<Value>(text) else {
            return false;
        };
        if value["type"] != "signal" {
            return false;
        }
        let Some(to) = value["to"].as_str().filter(|id| valid_id(id)) else {
            return false;
        };
        let signal = &value["signal"];
        if !matches!(
            signal["kind"].as_str(),
            Some("request" | "description" | "candidate")
        ) {
            return false;
        }
        let peers = self.peers.lock().unwrap();
        if let Some(peer) = peers.get(to) {
            // The sender is taken from the authenticated socket, never from the message.
            return peer
                .tx
                .try_send(json!({"type": "signal", "from": from, "signal": signal}).to_string())
                .is_ok();
        }
        false
    }
}

pub async fn ws(
    State(state): State<Shared>,
    Query(reg): Query<Registration>,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !valid_id(&reg.id) || reg.name.trim().is_empty() || reg.name.chars().count() > 48 {
        return (StatusCode::BAD_REQUEST, "invalid AirPear identity").into_response();
    }
    upgrade
        .max_message_size(64 * 1024)
        .max_frame_size(64 * 1024)
        .on_upgrade(move |socket| session(socket, state, reg))
}

async fn session(socket: WebSocket, state: Shared, reg: Registration) {
    let (tx, mut rx) = mpsc::channel(64);
    if !state.airpear.register(&reg.id, reg.name.trim(), tx) {
        return;
    }
    let (mut out, mut input) = socket.split();
    let mut heartbeat = tokio::time::interval(Duration::from_secs(20));
    let mut last_seen = Instant::now();
    let mut rate_start = Instant::now();
    let mut messages = 0;
    loop {
        tokio::select! {
            message = rx.recv() => match message {
                Some(message) => if out.send(Message::Text(message.into())).await.is_err() { break; },
                None => break,
            },
            message = input.next() => match message {
                Some(Ok(Message::Text(text))) => {
                    last_seen = Instant::now();
                    if rate_start.elapsed() > Duration::from_secs(10) { rate_start = Instant::now(); messages = 0; }
                    messages += 1;
                    if messages > 160 { break; }
                    state.airpear.relay(&reg.id, &text);
                },
                Some(Ok(Message::Pong(_))) => last_seen = Instant::now(),
                Some(Ok(Message::Ping(bytes))) => { if out.send(Message::Pong(bytes)).await.is_err() { break; } },
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                _ => {},
            },
            _ = heartbeat.tick() => {
                if last_seen.elapsed() > Duration::from_secs(65) { break; }
                if out.send(Message::Ping(Vec::new().into())).await.is_err() { break; }
            },
        }
    }
    state.airpear.remove(&reg.id);
    let _ = out.send(Message::Close(None)).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_relay_and_cleanup() {
        let hub = Hub::default();
        let (tx_a, mut rx_a) = mpsc::channel(64);
        let (tx_b, mut rx_b) = mpsc::channel(64);
        let a = "aaaaaaaaaaaaaaaa";
        let b = "bbbbbbbbbbbbbbbb";
        assert!(hub.register(a, "You", tx_a.clone()));
        assert!(!hub.register(a, "Impostor", tx_a));
        assert!(hub.register(b, "Also you", tx_b));
        while rx_b.try_recv().is_ok() {}
        assert!(
            hub.relay(
                a,
                &json!({"type":"signal", "from":"spoof", "to":b, "signal":{"kind":"request"}})
                    .to_string()
            )
        );
        let message: Value = serde_json::from_str(&rx_b.try_recv().unwrap()).unwrap();
        assert_eq!(message["from"], a);
        assert!(!hub.relay(
            a,
            &json!({"type":"file", "to":b, "signal":{"kind":"file"}}).to_string()
        ));
        assert!(!hub.relay(a, "invalid json"));
        while rx_a.try_recv().is_ok() {}
        hub.remove(b);
        let message: Value = serde_json::from_str(&rx_a.try_recv().unwrap()).unwrap();
        assert_eq!(message["peers"].as_array().unwrap().len(), 1);
        assert!(!hub.relay(
            a,
            &json!({"type":"signal", "to":b, "signal":{"kind":"request"}}).to_string()
        ));
    }
    #[test]
    fn identity_validation() {
        assert!(valid_id("01234567-89ab-cdef-0123-456789abcdef"));
        assert!(!valid_id("../other-peer"));
        assert!(!valid_id("x"));
    }
}
