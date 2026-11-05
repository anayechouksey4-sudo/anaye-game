/** Chassis internals the mounted car exposes for diagnostics (read by window.__RACER__). */
export interface CarDebugInfo {
  mass: number;
  localCom: { x: number; y: number; z: number };
  suspensionStiffness: number[];
  suspensionCompression: number[];
  suspensionRelaxation: number[];
}

/** Filled by Car.tsx while mounted. */
export const carDebug: { info: (() => CarDebugInfo) | null } = { info: null };
