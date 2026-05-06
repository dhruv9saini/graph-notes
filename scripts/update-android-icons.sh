#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

SVG_IN="${APP_DIR}/public/notes.svg"
RES_DIR="${APP_DIR}/android/app/src/main/res"

if [[ ! -f "${SVG_IN}" ]]; then
  echo "Missing ${SVG_IN}" >&2
  exit 1
fi

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "Missing rsvg-convert (librsvg). Install it and retry." >&2
  exit 1
fi

if command -v magick >/dev/null 2>&1; then
  IM="magick"
elif command -v convert >/dev/null 2>&1; then
  IM="convert"
else
  echo "Missing ImageMagick (magick/convert)." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "${TMP_DIR}"; }
trap cleanup EXIT

BASE_PNG="${TMP_DIR}/base-1024.png"
rsvg-convert -w 1024 -h 1024 "${SVG_IN}" > "${BASE_PNG}"

make_legacy_square() {
  local size="$1"
  local out="$2"
  local icon_px="$(( (size * 84) / 100 ))"
  "${IM}" -size "${size}x${size}" "xc:#000000" \
    "(" "${BASE_PNG}" -resize "${icon_px}x${icon_px}" ")" \
    -gravity center -composite "${out}"
}

make_legacy_round() {
  local size="$1"
  local in_png="$2"
  local out="$3"
  local cx="$(( size / 2 ))"
  "${IM}" "${in_png}" \
    "(" -size "${size}x${size}" "xc:none" -fill white -draw "circle ${cx},${cx} ${cx},0" ")" \
    -alpha off -compose CopyOpacity -composite "${out}"
}

make_adaptive_foreground() {
  local fg_size="$1"
  local out="$2"
  local icon_px="$(( (fg_size * 2) / 3 ))"
  "${IM}" "${BASE_PNG}" -resize "${icon_px}x${icon_px}" -background none -gravity center -extent "${fg_size}x${fg_size}" "${out}"
}

write_density() {
  local density="$1"
  local legacy_size="$2"
  local fg_size="$3"
  local dir="${RES_DIR}/mipmap-${density}"
  mkdir -p "${dir}"

  local legacy="${dir}/ic_launcher.png"
  local round="${dir}/ic_launcher_round.png"
  local fg="${dir}/ic_launcher_foreground.png"

  local legacy_tmp="${TMP_DIR}/legacy-${density}.png"
  make_legacy_square "${legacy_size}" "${legacy_tmp}"
  cp -f "${legacy_tmp}" "${legacy}"

  make_legacy_round "${legacy_size}" "${legacy_tmp}" "${round}"
  make_adaptive_foreground "${fg_size}" "${fg}"
}

write_density "mdpi" 48 108
write_density "hdpi" 72 162
write_density "xhdpi" 96 216
write_density "xxhdpi" 144 324
write_density "xxxhdpi" 192 432

echo "Updated Android launcher icons from ${SVG_IN}"
