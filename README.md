# Graph Notes

By Dhruv Saini. [Video demonstration](https://drive.google.com/file/d/1FhOEWrFZQKOaWhtqX9v4ZyAvTKfGtIrm/view).

Graph Notes is a local-first graph note app. Notes appear as linked cards on a physics-backed canvas; selecting a card opens a side pane for editing the title, Markdown body, and numeric links.

The app is meant to run on your own machine. The web server serves the built app and stores notes on disk in `notes-data/`.

## What I built

The app combines Markdown editing with a spatial map of linked notes. My code implements the graph interface, note/link editing, local file storage and web API, and connects the graph layout to the physics simulation.

React handles the UI framework, Matter.js supplies the physics engine, Toast UI supplies the Markdown editor, and Capacitor supplies the Android wrapper. Personal note contents are separate from the application source.

## Source guide

- [src/App.tsx](src/App.tsx): note editing and application state.
- [src/components/GraphCanvas.tsx](src/components/GraphCanvas.tsx): graph interaction and physics integration.
- [server/notes-web-server.ts](server/notes-web-server.ts): local note storage and API.
- [notes-config.toml](notes-config.toml): default appearance and interaction settings.

## Install

Requirements:

- Linux with systemd user services
- [Bun](https://bun.sh/docs/installation)
- Git

Clone and build:

```bash
git clone https://github.com/dhruv9saini/graph-notes.git
cd graph-notes
bun install
bun run build:web
```

Install and start the user service:

```bash
scripts/install-web-autostart.sh
```

The service is installed as `graph-notes-web.service` under `~/.config/systemd/user/`. It listens on port `43679`.

Open:

```text
http://localhost:43679
```

Useful service commands:

```bash
systemctl --user status graph-notes-web.service
systemctl --user restart graph-notes-web.service
systemctl --user stop graph-notes-web.service
```

To keep the service running after logout and at boot, enable lingering for your user:

```bash
loginctl enable-linger "$USER"
```

## Manual Run

You can run the server without installing the service:

```bash
bun install
bun run build:web
bun run serve
```

The server writes runtime files such as `notes-data/notes-web.port`, `notes-data/notes-web.url`, and `notes-data/notes-web.log`.

## Using The App

- Drag empty canvas space to pan.
- Scroll to zoom.
- Click a node to edit it.
- Drag nodes to reposition them.
- Use the `+` button to create a note.
- Edit links as note numbers, for example `1, 3, 8`.

Links are undirected: linking note 1 to note 3 also links note 3 back to note 1.

## Data

Your notes are stored in `notes-data/`, which is created on first run:

- `notes-data/notes.toml` stores note metadata: id, title, links, and position.
- `notes-data/notes/<id>.md` stores each note body as Markdown.
- `notes-data/notes-config.toml` stores runtime config, seeded from `notes-config.toml`.

The app repository ignores `notes-data/` so private notes do not get committed with the source code.

On first run, the server seeds a starter note. If it finds an older `~/notes` or `~/.notes` directory, it migrates that directory into `notes-data/`.

## Optional Note Backup

The app has a git sync endpoint for `notes-data/`, separate from the app source repository. To use it, initialize `notes-data/` as its own private repository and set a remote:

```bash
cd notes-data
git init
git add -A
git commit -m "Initial notes"
git remote add origin <your-private-notes-repo-url>
git push -u origin master
```

Keep that notes repository private if it contains personal data.

## Scripts

- `bun run dev` starts the Vite dev server.
- `bun run build:web` type-checks and builds the web app into `dist/`.
- `bun run serve` starts the Bun web/API server.
- `bun run lint` runs ESLint.
- `bun run build:apk` builds a debug Android APK with Capacitor.
- `scripts/install-web-autostart.sh` installs and starts the systemd user service.
- `scripts/notes-web-start.sh` starts the web server in the foreground.

## Android APK

The Android project is included for building a debug APK. By default the APK build script tries to point the app at the machine's first Tailscale IPv4 address:

```bash
bun run build:apk
```

Set the API base URL explicitly when needed:

```bash
NOTES_API_BASE_URL="http://your-host:43679" bun run build:apk
```

## Configuration

Default runtime settings live in `notes-config.toml`. On first run they are copied to `notes-data/notes-config.toml`, and the app reads the runtime copy from then on.

Config includes canvas sizing, graph physics, theme colors, mobile title sizing, and keyboard shortcuts.