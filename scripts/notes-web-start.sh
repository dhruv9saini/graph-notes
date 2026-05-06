#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

LOG_DIR="${APP_DIR}/notes-data"
PORT_FILE="${LOG_DIR}/notes-web.port"
URL_FILE="${LOG_DIR}/notes-web.url"
PORT="43679"
BUN_BIN="${BUN_BIN:-${HOME}/.bun/bin/bun}"
LOG_FILE="${LOG_DIR}/notes-web.log"

mkdir -p "${LOG_DIR}"

if [[ ! -f "${APP_DIR}/dist/index.html" ]]; then
  echo "Missing dist/. Run: bun run build:web" >> "${LOG_FILE}"
  exit 1
fi

if [[ -z "${BUN_BIN:-}" || ! -x "${BUN_BIN}" ]]; then
  BUN_BIN="$(command -v bun || true)"
fi

if [[ -z "${BUN_BIN}" || ! -x "${BUN_BIN}" ]]; then
  echo "Missing bun binary. Install Bun first or set BUN_BIN=/path/to/bun." >&2
  exit 1
fi

cd "${APP_DIR}"
exec "${BUN_BIN}" run server/notes-web-server.ts --port "${PORT}" --port-file "${PORT_FILE}" --url-file "${URL_FILE}"
