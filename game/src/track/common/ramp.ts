/**
 * Curved ramp profiles built from flat boxes. A single sharp kink hit at 190 km/h slams the
 * suspension (≈37 kN per front wheel) and scrubs ~14 km/h, so ramps should ease in over a few
 * segments of increasing pitch. Works in a local frame where the ramp climbs toward +Z.
 */

export interface RampSegmentSpec {
  /** Pitch of this segment, degrees (positive climbs). */
  angleDeg: number;
  /** Length along the surface, m. */
  length: number;
}

export interface RampSegment {
  /** Box centre (local frame) for a box of [width, thickness, length] rotated by `pitch` about X. */
  center: [number, number, number];
  /** Rotation about +X to apply (negative climbs toward +Z in three.js). */
  rotationX: number;
  length: number;
}

export interface RampBuild {
  segments: RampSegment[];
  /** Top-surface point at the end of the last segment (the lip), local frame. */
  lip: [number, number, number];
  /** Pitch of the last segment, rad (take-off angle). */
  takeoffAngle: number;
}

/** Lay segments end-to-end starting at the top-surface point (0, startY, startZ). */
export function buildRamp(startZ: number, profile: readonly RampSegmentSpec[], thickness: number, startY = 0): RampBuild {
  let z = startZ;
  let y = startY;
  let angle = 0;
  const h = thickness / 2;
  const segments: RampSegment[] = profile.map(({ angleDeg, length }) => {
    angle = (angleDeg * Math.PI) / 180;
    const l = length / 2;
    const center: [number, number, number] = [
      0,
      y - h * Math.cos(angle) + l * Math.sin(angle),
      z + h * Math.sin(angle) + l * Math.cos(angle),
    ];
    z += length * Math.cos(angle);
    y += length * Math.sin(angle);
    return { center, rotationX: -angle, length };
  });
  return { segments, lip: [0, y, z], takeoffAngle: angle };
}
