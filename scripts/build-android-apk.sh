#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
APK_PATH="${APP_DIR}/android/app/build/outputs/apk/debug/app-debug.apk"

cd "${APP_DIR}"

if [[ -z "${JAVA_HOME:-}" ]] && command -v javac >/dev/null 2>&1; then
  JAVA_HOME="$(dirname -- "$(dirname -- "$(readlink -f -- "$(command -v javac)")")")"
  export JAVA_HOME
fi

if [[ -z "${ANDROID_HOME:-}" ]] && [[ -d "${HOME}/Android/Sdk" ]]; then
  ANDROID_HOME="${HOME}/Android/Sdk"
  export ANDROID_HOME
fi
if [[ -z "${ANDROID_SDK_ROOT:-}" ]] && [[ -n "${ANDROID_HOME:-}" ]]; then
  ANDROID_SDK_ROOT="${ANDROID_HOME}"
  export ANDROID_SDK_ROOT
fi

if [[ -n "${NOTES_API_BASE_URL:-}" ]]; then
  API_BASE_URL="${NOTES_API_BASE_URL}"
else
  TAILNET_IP="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
  if [[ -z "${TAILNET_IP}" ]]; then
    echo "Could not determine tailnet IPv4. Set NOTES_API_BASE_URL explicitly." >&2
    exit 1
  fi
  API_BASE_URL="http://${TAILNET_IP}:43679"
fi

echo "Using API base URL: ${API_BASE_URL}"
VITE_NOTES_API_BASE_URL="${API_BASE_URL}" bun run build:web

if [[ ! -f "${APP_DIR}/android/gradlew" ]]; then
  bunx cap add android
fi

bunx cap sync android

if [[ -n "${ANDROID_HOME:-}" ]]; then
  printf "sdk.dir=%s\n" "${ANDROID_HOME}" > "${APP_DIR}/android/local.properties"
fi

(
  cd android
  ./gradlew assembleDebug
)

echo "APK ready: ${APK_PATH}"
