import { loadAppConfig } from "./appConfig";

export type CanvasTheme = {
  backgroundFill: string;
  gridStroke: string;
  linkStroke: string;
  nodeFill: string;
  nodeFillEmpty: string;
  nodeFillAnchor: string;
  nodeFillSelected: string;
  nodeStroke: string;
  nodeStrokeSelected: string;
  nodeText: string;
  nodeTextSelected: string;
};

export type ThemeConfig = {
  pageBackground: string;
  pageText: string;
  workspaceBackground: string;
  canvasWrapBackground: string;
  splitterBackground: string;
  splitterHoverBackground: string;
  sidePaneBackground: string;
  sidePaneEmptyText: string;
  dividerBackground: string;
  inputText: string;
  inputUnderline: string;
  inputUnderlineFocus: string;
  segmentedText: string;
  segmentedHoverBackground: string;
  segmentedActiveText: string;
  segmentedActiveUnderline: string;
  editorLink: string;
  editorPreviewDivider: string;
  statusDotBorder: string;
  statusDotIdle: string;
  statusDotSaving: string;
  statusDotError: string;
  bannerBackground: string;
  bannerBorder: string;
  bannerText: string;
  bannerShadow: string;
  bannerSuccessBorder: string;
  bannerSuccessText: string;
  bannerErrorBorder: string;
  bannerErrorText: string;
  canvas: CanvasTheme;
};

export const DEFAULT_THEME: ThemeConfig = {
  pageBackground: "#000000",
  pageText: "#e9edf5",
  workspaceBackground: "#000000",
  canvasWrapBackground: "#000000",
  splitterBackground: "rgba(255, 255, 255, 0.06)",
  splitterHoverBackground: "rgba(255, 179, 71, 0.22)",
  sidePaneBackground: "#000000",
  sidePaneEmptyText: "rgba(233, 237, 245, 0.72)",
  dividerBackground: "rgba(255, 255, 255, 0.14)",
  inputText: "#f7f8fb",
  inputUnderline: "rgba(255, 255, 255, 0.16)",
  inputUnderlineFocus: "rgba(255, 179, 71, 0.6)",
  segmentedText: "rgba(247, 248, 251, 0.9)",
  segmentedHoverBackground: "rgba(255, 255, 255, 0.04)",
  segmentedActiveText: "#ffd7a0",
  segmentedActiveUnderline: "rgba(255, 179, 71, 0.7)",
  editorLink: "#ffb347",
  editorPreviewDivider: "rgba(255, 255, 255, 0.06)",
  statusDotBorder: "rgba(255, 255, 255, 0.25)",
  statusDotIdle: "#6ce28f",
  statusDotSaving: "#f0c674",
  statusDotError: "#ff6f6f",
  bannerBackground: "rgba(14, 16, 24, 0.9)",
  bannerBorder: "rgba(255, 255, 255, 0.12)",
  bannerText: "#e9edf5",
  bannerShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
  bannerSuccessBorder: "#ffb347",
  bannerSuccessText: "#ffb347",
  bannerErrorBorder: "#ff6f6f",
  bannerErrorText: "#ffbebe",
  canvas: {
    backgroundFill: "#000000",
    gridStroke: "rgba(255, 255, 255, 0.1)",
    linkStroke: "rgba(255, 255, 255, 0.24)",
    nodeFill: "#151a25",
    nodeFillEmpty: "#080a0f",
    nodeFillAnchor: "#273447",
    nodeFillSelected: "#f6b649",
    nodeStroke: "rgba(255, 255, 255, 0.16)",
    nodeStrokeSelected: "#ce7b00",
    nodeText: "#e8ebf1",
    nodeTextSelected: "#111",
  },
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim().length) return v;
  return undefined;
}

function sanitizeCanvasTheme(input: unknown): CanvasTheme {
  const obj = asRecord(input);
  const d = DEFAULT_THEME.canvas;
  return {
    backgroundFill: asString(obj.backgroundFill) ?? d.backgroundFill,
    gridStroke: asString(obj.gridStroke) ?? d.gridStroke,
    linkStroke: asString(obj.linkStroke) ?? d.linkStroke,
    nodeFill: asString(obj.nodeFill) ?? d.nodeFill,
    nodeFillEmpty: asString(obj.nodeFillEmpty) ?? d.nodeFillEmpty,
    nodeFillAnchor: asString(obj.nodeFillAnchor) ?? d.nodeFillAnchor,
    nodeFillSelected: asString(obj.nodeFillSelected) ?? d.nodeFillSelected,
    nodeStroke: asString(obj.nodeStroke) ?? d.nodeStroke,
    nodeStrokeSelected: asString(obj.nodeStrokeSelected) ?? d.nodeStrokeSelected,
    nodeText: asString(obj.nodeText) ?? d.nodeText,
    nodeTextSelected: asString(obj.nodeTextSelected) ?? d.nodeTextSelected,
  };
}

function sanitizeThemeConfig(input: unknown): ThemeConfig {
  const obj = asRecord(input);
  const d = DEFAULT_THEME;
  return {
    pageBackground: asString(obj.pageBackground) ?? d.pageBackground,
    pageText: asString(obj.pageText) ?? d.pageText,
    workspaceBackground: asString(obj.workspaceBackground) ?? d.workspaceBackground,
    canvasWrapBackground: asString(obj.canvasWrapBackground) ?? d.canvasWrapBackground,
    splitterBackground: asString(obj.splitterBackground) ?? d.splitterBackground,
    splitterHoverBackground: asString(obj.splitterHoverBackground) ?? d.splitterHoverBackground,
    sidePaneBackground: asString(obj.sidePaneBackground) ?? d.sidePaneBackground,
    sidePaneEmptyText: asString(obj.sidePaneEmptyText) ?? d.sidePaneEmptyText,
    dividerBackground: asString(obj.dividerBackground) ?? d.dividerBackground,
    inputText: asString(obj.inputText) ?? d.inputText,
    inputUnderline: asString(obj.inputUnderline) ?? d.inputUnderline,
    inputUnderlineFocus: asString(obj.inputUnderlineFocus) ?? d.inputUnderlineFocus,
    segmentedText: asString(obj.segmentedText) ?? d.segmentedText,
    segmentedHoverBackground: asString(obj.segmentedHoverBackground) ?? d.segmentedHoverBackground,
    segmentedActiveText: asString(obj.segmentedActiveText) ?? d.segmentedActiveText,
    segmentedActiveUnderline: asString(obj.segmentedActiveUnderline) ?? d.segmentedActiveUnderline,
    editorLink: asString(obj.editorLink) ?? d.editorLink,
    editorPreviewDivider: asString(obj.editorPreviewDivider) ?? d.editorPreviewDivider,
    statusDotBorder: asString(obj.statusDotBorder) ?? d.statusDotBorder,
    statusDotIdle: asString(obj.statusDotIdle) ?? d.statusDotIdle,
    statusDotSaving: asString(obj.statusDotSaving) ?? d.statusDotSaving,
    statusDotError: asString(obj.statusDotError) ?? d.statusDotError,
    bannerBackground: asString(obj.bannerBackground) ?? d.bannerBackground,
    bannerBorder: asString(obj.bannerBorder) ?? d.bannerBorder,
    bannerText: asString(obj.bannerText) ?? d.bannerText,
    bannerShadow: asString(obj.bannerShadow) ?? d.bannerShadow,
    bannerSuccessBorder: asString(obj.bannerSuccessBorder) ?? d.bannerSuccessBorder,
    bannerSuccessText: asString(obj.bannerSuccessText) ?? d.bannerSuccessText,
    bannerErrorBorder: asString(obj.bannerErrorBorder) ?? d.bannerErrorBorder,
    bannerErrorText: asString(obj.bannerErrorText) ?? d.bannerErrorText,
    canvas: sanitizeCanvasTheme(asRecord(obj.canvas)),
  };
}

let cachedTheme: ThemeConfig | null = null;

export async function loadThemeConfig(): Promise<ThemeConfig> {
  if (cachedTheme) return cachedTheme;
  try {
    const cfg = await loadAppConfig();
    const top = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
    cachedTheme = sanitizeThemeConfig(top.theme);
    return cachedTheme;
  } catch {
    cachedTheme = DEFAULT_THEME;
    return cachedTheme;
  }
}
