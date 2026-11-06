/** Chassis internals the mounted car exposes for diagnostics (read by window.__RACER__). */
export interface CarDebugInfo {
  /** Rapier handle of the chassis body: stays the same unless the car remounts. */
  bodyHandle: number;
  mass: number;
  localCom: { x: number; y: number; z: number };
  suspensionStiffness: number[];
  suspensionCompression: number[];
  suspensionRelaxation: number[];
  /** Car class of the mounted car, and its ride height (body origin above flat ground at rest), m. */
  carId: string;
  rideHeight: number;
}

/** Filled by Car.tsx while mounted. */
export const carDebug: {
  info: (() => CarDebugInfo) | null;
  /** Put the car at a ground point facing yaw, stopped (does not touch run progress). */
  place: ((groundPosition: [number, number, number], yaw: number) => void) | null;
} = { info: null, place: null };
