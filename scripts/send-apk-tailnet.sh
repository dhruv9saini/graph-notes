#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <tailnet-device> [apk-path]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
TARGET_DEVICE="$1"
APK_PATH="${2:-${APP_DIR}/android/app/build/outputs/apk/debug/app-debug.apk}"

if [[ ! -f "${APK_PATH}" ]]; then
  echo "APK not found at ${APK_PATH}" >&2
  exit 1
fi

tailscale file cp "${APK_PATH}" "${TARGET_DEVICE}:"
echo "Sent ${APK_PATH} to ${TARGET_DEVICE}"
