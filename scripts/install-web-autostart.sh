#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DATA_DIR="${APP_DIR}/notes-data"
SYSTEMD_DIR="${HOME}/.config/systemd/user"
SERVICE_FILE="${SYSTEMD_DIR}/graph-notes-web.service"
LEGACY_DESKTOP="${HOME}/.config/autostart/graph-notes-web.desktop"
BUN_BIN="${BUN_BIN:-${HOME}/.bun/bin/bun}"

if [[ -z "${BUN_BIN:-}" || ! -x "${BUN_BIN}" ]]; then
  BUN_BIN="$(command -v bun || true)"
fi

if [[ -z "${BUN_BIN}" || ! -x "${BUN_BIN}" ]]; then
  echo "Missing bun binary. Install Bun first or set BUN_BIN=/path/to/bun." >&2
  exit 1
fi

if [[ ! -f "${APP_DIR}/dist/index.html" ]]; then
  echo "Missing dist/. Run: bun install && bun run build:web" >&2
  exit 1
fi

mkdir -p "${SYSTEMD_DIR}"
mkdir -p "${DATA_DIR}"

cat > "${SERVICE_FILE}" <<SERVICE
[Unit]
Description=Graph Notes web server

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=${BUN_BIN} run server/notes-web-server.ts --port 43679 --port-file ${DATA_DIR}/notes-web.port --url-file ${DATA_DIR}/notes-web.url
Restart=always
RestartSec=2
StartLimitIntervalSec=0
StandardOutput=append:${DATA_DIR}/notes-web.log
StandardError=append:${DATA_DIR}/notes-web.log

[Install]
WantedBy=default.target
SERVICE

if [[ -f "${LEGACY_DESKTOP}" ]]; then
  rm -f "${LEGACY_DESKTOP}"
fi

systemctl --user daemon-reload
systemctl --user enable --now graph-notes-web.service

echo "Installed ${SERVICE_FILE}"
