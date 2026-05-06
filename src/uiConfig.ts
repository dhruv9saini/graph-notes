import { loadAppConfig } from "./appConfig";

export type UiConfig = {
  sideWidthPx: number;
  titleHeightPx: number;
  mobileTitleHeightPx: number;
  linksHeightPx: number;
  splitterPx: number;
  sidePaddingPx: number;
  titleFontPx: number;
  mobileTitleFontPx: number;
  linksFontPx: number;
  editorFontPx: number;
};

export const DEFAULT_UI_CONFIG: UiConfig = {
  sideWidthPx: 420,
  titleHeightPx: 102,
  mobileTitleHeightPx: 72,
  linksHeightPx: 39,
  splitterPx: 10,
  sidePaddingPx: 6,
  titleFontPx: 42,
  mobileTitleFontPx: 28,
  linksFontPx: 18,
  editorFontPx: 16,
};

function asFiniteNumber(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

function sanitizeUiConfig(input: unknown): UiConfig {
  const obj =
    input && typeof input === "object" ? (input as Record<string, unknown>) : ({} as Record<string, unknown>);
  const d = DEFAULT_UI_CONFIG;

  const sideWidthPx = clampInt(asFiniteNumber(obj.sideWidthPx) ?? d.sideWidthPx, 260, 2000);
  const titleHeightPx = clampInt(asFiniteNumber(obj.titleHeightPx) ?? d.titleHeightPx, 24, 180);
  const mobileTitleHeightDefault = Math.round(
    titleHeightPx * (d.mobileTitleHeightPx / d.titleHeightPx)
  );
  const mobileTitleHeightPx = clampInt(
    asFiniteNumber(obj.mobileTitleHeightPx) ?? mobileTitleHeightDefault,
    20,
    160
  );
  const linksHeightPx = clampInt(asFiniteNumber(obj.linksHeightPx) ?? d.linksHeightPx, 18, 240);
  const splitterPx = clampInt(asFiniteNumber(obj.splitterPx) ?? d.splitterPx, 6, 24);
  const sidePaddingPx = clampInt(asFiniteNumber(obj.sidePaddingPx) ?? d.sidePaddingPx, 0, 32);
  const titleFontDefault = Math.round(titleHeightPx * (d.titleFontPx / d.titleHeightPx));
  const linksFontDefault = Math.round(linksHeightPx * (d.linksFontPx / d.linksHeightPx));
  const titleFontPx = clampInt(asFiniteNumber(obj.titleFontPx) ?? titleFontDefault, 10, 96);
  const mobileTitleFontDefault = Math.round(
    titleFontPx * (d.mobileTitleFontPx / d.titleFontPx)
  );
  const mobileTitleFontPx = clampInt(
    asFiniteNumber(obj.mobileTitleFontPx) ?? mobileTitleFontDefault,
    10,
    80
  );
  const linksFontPx = clampInt(asFiniteNumber(obj.linksFontPx) ?? linksFontDefault, 10, 64);
  const editorFontPx = clampInt(asFiniteNumber(obj.editorFontPx) ?? d.editorFontPx, 10, 48);

  return {
    sideWidthPx,
    titleHeightPx,
    mobileTitleHeightPx,
    linksHeightPx,
    splitterPx,
    sidePaddingPx,
    titleFontPx,
    mobileTitleFontPx,
    linksFontPx,
    editorFontPx,
  };
}

let cachedUiConfig: UiConfig | null = null;

export async function loadUiConfig(): Promise<UiConfig> {
  if (cachedUiConfig) return cachedUiConfig;
  try {
    const cfg = await loadAppConfig();
    const top = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
    cachedUiConfig = sanitizeUiConfig(top.ui);
    return cachedUiConfig;
  } catch {
    cachedUiConfig = DEFAULT_UI_CONFIG;
    return cachedUiConfig;
  }
}
