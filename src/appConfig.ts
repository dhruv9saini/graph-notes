import { buildApiUrl } from "./apiBase";

export type RawAppConfig = Record<string, unknown>;

let cachedConfig: RawAppConfig | null = null;
let inflight: Promise<RawAppConfig> | null = null;

export async function loadAppConfig(): Promise<RawAppConfig> {
  if (cachedConfig) return cachedConfig;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(buildApiUrl("/api/config"));
      if (!res.ok) {
        throw new Error(`Config load failed: ${res.status}`);
      }
      const raw = (await res.json()) as RawAppConfig;
      const cfg = raw && typeof raw === "object" ? raw : {};
      cachedConfig = cfg;
      return cfg;
    } catch {
      cachedConfig = {};
      return {};
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function clearAppConfigCache() {
  cachedConfig = null;
  inflight = null;
}
