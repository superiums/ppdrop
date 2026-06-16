# ppdrop

A lightweight **local network file & clipboard sharing** tool. Powered by Rust + WebRTC.

Works with Single File.

Inspired by [PairDrop](https://github.com/schlagmichdoch/PairDrop). No setup, no signup, no cloud — just open the page and share.

## Features

- **📋 Clipboard sharing** — Send text between devices. Received text is auto-copied.
- **📁 File transfer** — Send files peer-to-peer with receiver confirmation.
- **🔗 No registration** — Open the web page, devices on the same LAN find each other automatically.
- **🌐 Cross-platform** — Works on any device with a modern browser (desktop, phone, tablet).
- **🚀 P2P by WebRTC** — Files and text go directly between devices. Server only handles signaling.
- **🌍 i18n** — English & Chinese. Auto-detects browser language.
- **🔒 Self-hosted** — Run on your own machine. No third-party servers.

## Quick Start

```bash
# Download the latest binary from Releases
ppdrop
# Or build from source:
cargo run --release
```

Open `http://<your-lan-ip>:8080` on any device on the same network (or specify a custom port: `ppdrop 9090`).

On startup, the terminal displays a QR code for each LAN IP — scan it with your phone to open the page instantly.

languages: English and Chinese.

## Usage

| Action | How |
|---|---|
| **Send text** | Click `Send Text` on a peer → type/paste text → `Send` (or `Ctrl+Enter`) |
| **Send clipboard** | In the text dialog, click `📋 Read Clipboard` |
| **Send file** | Click `Send File` on a peer → select a file → receiver gets a confirmation dialog |
| **Receive text** | Text appears in a toast notification and is auto-copied |
| **Receive file** | Click `Accept & Download` to start receiving |
| **Change device name** | Click the device name to edit |

## CLI

```
ppdrop [PORT]
```

| Argument | Description |
|---|---|
| `PORT` | Port to listen on (default: `8080`) |
| `-h`, `--help` | Print help message |

## Build from Source

```bash
git clone https://github.com/your-username/ppdrop
cd ppdrop
cargo build --release
./target/release/ppdrop [PORT]
```

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────┐
│  Browser A   │ ←── signaling ──→ │  Rust Server │
│  (WebRTC)    │                   │  (warp)      │
│              │     WebRTC P2P    │              │
│  Browser B   │ ←── data channel─→│  (static fs) │
│  (WebRTC)    │                   └──────────────┘
└─────────────┘
```

- **Server** (`src/main.rs`): WebSocket signaling relay + static file server. ~140 lines.
- **Client** (`static/app.js`): WebRTC peer management, device discovery, text/file transfer.
- **UI** (`static/`): Vanilla HTML/CSS/JS. No frameworks.

## Release Builds

Pre-built binaries for 5 platforms (via GitHub Actions):

| Platform | File |
|---|---|
| Linux (glibc) | `ppdrop-x86_64-unknown-linux-gnu.tar.gz` |
| Linux (musl) | `ppdrop-x86_64-unknown-linux-musl.tar.gz` |
| Windows | `ppdrop-x86_64-pc-windows-gnu.zip` |
| macOS (Intel) | `ppdrop-x86_64-apple-darwin.tar.gz` |
| macOS (Apple Silicon) | `ppdrop-aarch64-apple-darwin.tar.gz` |

## License

GPL-3.0
