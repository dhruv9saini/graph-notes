import { loadAppConfig } from "./appConfig";

export type GraphPhysicsConfig = {
  repelSoftForce: number;
  repelCloseStrength: number;
  repelPadding: number;
  repelMaxForce: number;
  springDamping: number;
  springStiffnessExt: number;
  springLength: number;
  linkAngleStiffness: number;
  linkAngleMaxForce: number;
};

export const DEFAULT_GRAPH_PHYSICS: GraphPhysicsConfig = {
  repelSoftForce: 3.0,
  repelCloseStrength: 0.002,
  repelPadding: 48,
  repelMaxForce: 0.4,
  springDamping: 0.05,
  springStiffnessExt: 0.02,
  springLength: 220,
  linkAngleStiffness: 0.0003,
  linkAngleMaxForce: 0.35,
};

function asFiniteNumber(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function sanitizeGraphPhysicsConfig(input: unknown): GraphPhysicsConfig {
  const obj = (input && typeof input === "object" ? (input as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  const d = DEFAULT_GRAPH_PHYSICS;

  const repelSoftForce = asFiniteNumber(obj.repelSoftForce) ?? d.repelSoftForce;
  const repelCloseStrength = asFiniteNumber(obj.repelCloseStrength) ?? d.repelCloseStrength;
  const repelPadding = asFiniteNumber(obj.repelPadding) ?? d.repelPadding;
  const repelMaxForce = asFiniteNumber(obj.repelMaxForce) ?? d.repelMaxForce;
  const springDamping = asFiniteNumber(obj.springDamping) ?? d.springDamping;
  const springStiffnessExt = asFiniteNumber(obj.springStiffnessExt) ?? d.springStiffnessExt;
  const springLength = asFiniteNumber(obj.springLength) ?? d.springLength;
  const linkAngleStiffness = asFiniteNumber(obj.linkAngleStiffness) ?? d.linkAngleStiffness;
  const linkAngleMaxForce = asFiniteNumber(obj.linkAngleMaxForce) ?? d.linkAngleMaxForce;

  return {
    repelSoftForce,
    repelCloseStrength,
    repelPadding,
    repelMaxForce,
    springDamping,
    springStiffnessExt,
    springLength,
    linkAngleStiffness,
    linkAngleMaxForce,
  };
}

let cachedGraphPhysics: GraphPhysicsConfig | null = null;

export async function loadGraphPhysicsConfig(): Promise<GraphPhysicsConfig> {
  if (cachedGraphPhysics) return cachedGraphPhysics;
  try {
    const cfg = await loadAppConfig();
    const top = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
    const graph = top.graph && typeof top.graph === "object" ? (top.graph as Record<string, unknown>) : {};
    const physics =
      graph.physics && typeof graph.physics === "object"
        ? (graph.physics as Record<string, unknown>)
        : top.graphPhysics && typeof top.graphPhysics === "object"
          ? (top.graphPhysics as Record<string, unknown>)
          : {};
    cachedGraphPhysics = sanitizeGraphPhysicsConfig(physics);
    return cachedGraphPhysics;
  } catch {
    cachedGraphPhysics = DEFAULT_GRAPH_PHYSICS;
    return cachedGraphPhysics;
  }
}
