import { Capacitor } from "@capacitor/core";

const API_BASE_OVERRIDE_KEY = "notes:apiBaseUrl";

function normalizeBaseUrl(value: string | null | undefined): string {
  const raw = value?.trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const override = normalizeBaseUrl(window.localStorage.getItem(API_BASE_OVERRIDE_KEY));
    if (override) return override;
  }

  // Browser builds should use relative `/api/*` so the app works no matter which hostname
  // (MagicDNS, tailnet IP, LAN IP) the user used to open it.
  // Native builds (Capacitor) need an absolute API base URL.
  const isNative = (() => {
    try {
      return Capacitor.isNativePlatform();
    } catch {
      return false;
    }
  })();
  if (!isNative) return "";

  return normalizeBaseUrl(import.meta.env.VITE_NOTES_API_BASE_URL);
}

export function buildApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = getApiBaseUrl();
  if (!base) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

export { API_BASE_OVERRIDE_KEY };
