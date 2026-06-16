use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, mpsc};
use warp::Filter;
use warp::ws::{Message, WebSocket};
use futures_util::{StreamExt, SinkExt};
use serde::Deserialize;

type Peers = Arc<RwLock<HashMap<String, PeerInfo>>>;

struct PeerInfo {
    device_name: String,
    device_type: String,
    tx: mpsc::UnboundedSender<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
    #[serde(rename = "join")]
    Join { device_name: String, device_id: String, device_type: Option<String> },
    #[serde(rename = "signal")]
    Signal { to: String, data: serde_json::Value },
}

fn get_lan_ips() -> Vec<std::net::Ipv4Addr> {
    let mut ips = Vec::new();
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in &ifaces {
            if iface.is_loopback() { continue; }
            if let if_addrs::IfAddr::V4(v4) = &iface.addr {
                let ip = v4.ip;
                if ip.is_private() && !ip.is_link_local() {
                    ips.push(ip);
                }
            }
        }
    }
    ips.sort_by(|a, b| a.to_string().cmp(&b.to_string()));
    ips
}

fn print_qr(url: &str) {
    if let Ok(code) = qrcode::QrCode::new(url) {
        let qr = code.render::<qrcode::render::unicode::Dense1x2>()
            .dark_color(qrcode::render::unicode::Dense1x2::Dark)
            .light_color(qrcode::render::unicode::Dense1x2::Light)
            .build();
        for line in qr.lines() {
            println!("  {}", line);
        }
    }
}

fn print_banner(lan_ips: &[std::net::Ipv4Addr], port: u16) {
    println!("{:^38}", "ppdrop");

    if lan_ips.is_empty() {
        println!("  No LAN IP detected.");
        println!("  Open http://localhost:{} on this machine.\n", port);
        return;
    }

    for ip in lan_ips {
        let url = format!("http://{}:{}", ip, port);
        println!("  ┌─────────────────────────────────┐");
        println!("  │  {}", url);
        println!("  │");
        print_qr(&url);
        println!("  │  Scan to connect from mobile");
        println!("  └─────────────────────────────────┘\n");
    }

    println!("  Local:  http://localhost:{}\n", port);
}

fn print_help() {
    eprintln!("Usage: ppdrop [PORT]");
    eprintln!();
    eprintln!("Start a ppdrop server for LAN file and clipboard sharing.");
    eprintln!();
    eprintln!("Arguments:");
    eprintln!("  PORT  Port to listen on (default: 8080)");
    eprintln!();
    eprintln!("Options:");
    eprintln!("  -h, --help  Print this help message");
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|a| a == "-h" || a == "--help") {
        print_help();
        return;
    }

    let port: u16 = match args.get(1) {
        Some(p) => match p.parse() {
            Ok(n) if n > 0 => n,
            _ => {
                eprintln!("Invalid port: {}", p);
                std::process::exit(1);
            }
        },
        None => 8080,
    };

    let lan_ips = get_lan_ips();
    print_banner(&lan_ips, port);

    let peers: Peers = Arc::new(RwLock::new(HashMap::new()));

    let ws_route = warp::path("ws")
        .and(warp::ws())
        .and(warp::any().map(move || peers.clone()))
        .map(|ws: warp::ws::Ws, peers| ws.on_upgrade(move |s| handle_ws(s, peers)));

    let index = warp::path::end().map(|| {
        warp::http::Response::builder()
            .header("content-type", "text/html; charset=utf-8")
            .body(include_str!("../static/index.html"))
            .unwrap()
    });
    let app_js = warp::path("static").and(warp::path("app.js")).map(|| {
        warp::http::Response::builder()
            .header("content-type", "text/javascript; charset=utf-8")
            .body(include_str!("../static/app.js"))
            .unwrap()
    });
    let style_css = warp::path("static").and(warp::path("style.css")).map(|| {
        warp::http::Response::builder()
            .header("content-type", "text/css; charset=utf-8")
            .body(include_str!("../static/style.css"))
            .unwrap()
    });
    let lang_js = warp::path("static").and(warp::path("lang.js")).map(|| {
        warp::http::Response::builder()
            .header("content-type", "text/javascript; charset=utf-8")
            .body(include_str!("../static/lang.js"))
            .unwrap()
    });

    let routes = index
        .or(app_js)
        .or(style_css)
        .or(lang_js)
        .or(ws_route)
        .with(warp::cors().allow_any_origin());

    println!("  Listening on http://0.0.0.0:{}\n", port);
    warp::serve(routes).run(([0, 0, 0, 0], port)).await;
}

async fn handle_ws(ws: WebSocket, peers: Peers) {
    let (mut ws_tx, mut ws_rx) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(Message::text(msg)).await.is_err() {
                break;
            }
        }
    });

    let mut my_id: Option<String> = None;
    let mut my_name: Option<String> = None;
    let mut my_type: Option<String> = None;

    while let Some(Ok(msg)) = ws_rx.next().await {
        let text = match msg.to_str() {
            Ok(t) => t.to_owned(),
            Err(_) => continue,
        };

        let client_msg: ClientMessage = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(_) => continue,
        };

        match client_msg {
            ClientMessage::Join { device_name, device_id, device_type } => {
                let dt = device_type.clone().unwrap_or_default();
                {
                    let mut p = peers.write().await;
                    p.remove(&device_id);
                    p.insert(device_id.clone(), PeerInfo {
                        device_name: device_name.clone(),
                        device_type: dt.clone(),
                        tx: tx.clone(),
                    });
                }

                my_id = Some(device_id.clone());
                my_name = Some(device_name.clone());
                my_type = Some(dt.clone());

                let peer_list = {
                    let p = peers.read().await;
                    let list: Vec<serde_json::Value> = p.iter()
                        .filter(|(id, _)| *id != &device_id)
                        .map(|(id, info)| serde_json::json!({
                            "device_id": id,
                            "device_name": info.device_name,
                            "device_type": info.device_type,
                        }))
                        .collect();
                    serde_json::json!({"type": "peer_list", "peers": list}).to_string()
                };
                let _ = tx.send(peer_list);

                let notification = serde_json::json!({
                    "type": "peer_joined",
                    "device_id": device_id,
                    "device_name": device_name,
                    "device_type": dt,
                });
                let notify_str = notification.to_string();
                let p = peers.read().await;
                for (id, info) in p.iter() {
                    if *id != *my_id.as_ref().unwrap() {
                        let _ = info.tx.send(notify_str.clone());
                    }
                }
            }
            ClientMessage::Signal { to, data } => {
                let from_id = my_id.as_deref().unwrap_or("?").to_string();
                let from_name = my_name.as_deref().unwrap_or("?").to_string();
                let from_type = my_type.as_deref().unwrap_or("").to_string();
                let p = peers.read().await;
                if let Some(target) = p.get(&to) {
                    let msg = serde_json::json!({
                        "type": "signal",
                        "from": from_id,
                        "from_name": from_name,
                        "from_type": from_type,
                        "data": data,
                    });
                    let _ = target.tx.send(msg.to_string());
                }
            }
        }
    }

    if let Some(id) = my_id {
        let mut p = peers.write().await;
        p.remove(&id);
        let notification = serde_json::json!({"type": "peer_left", "device_id": id}).to_string();
        for info in p.values() {
            let _ = info.tx.send(notification.clone());
        }
    }

    send_task.await.unwrap_or(());
}
