/**
 * Camera floor seam: the lowest camera Y allowed at (x, z) (terrain + clearance). Only an open
 * world installs one; without it the floor is -Infinity and the chase camera is unchanged.
 */
export type CameraFloorResolver = (x: number, z: number) => number;

let resolver: CameraFloorResolver | null = null;

export function setCameraFloorResolver(fn: CameraFloorResolver): () => void {
  resolver = fn;
  return () => {
    if (resolver === fn) resolver = null;
  };
}

export const cameraFloor = (x: number, z: number): number => (resolver ? resolver(x, z) : -Infinity);
