/**
 * Handling constants that are NOT part of the wire protocol (those live in shared/protocol.ts
 * and arrive live from the dashboard). Grouped here so calibration touches one file.
 */
export const CAR_TUNING = {
  // ── Tyres ────────────────────────────────────────────────────────────────────────────────
  /** Longitudinal grip = traction × this. < 1 so tier 4–5 torque overwhelms the rear tyres off the line. */
  longitudinalGripRatio: 0.72,
  /** Rapier side-friction stiffness = clamp(base + perTraction × traction, min, 1). */
  sideStiffnessBase: 0.4,
  sideStiffnessPerTraction: 0.4,
  sideStiffnessMin: 0.3,
  /** A spinning rear tyre loses this fraction of lateral grip at `spinGripLossFullSlip` m/s of wheelspin. */
  spinGripLoss: 0.45,
  spinGripLossFullSlip: 6,

  // ── Steering (speed sensitive) ───────────────────────────────────────────────────────────
  /** Max front-wheel angle at standstill, rad. */
  steerMax: 0.58,
  /** Max angle = steerMax / (1 + |v| / steerSpeedFalloff), floored at steerMin. */
  steerSpeedFalloff: 13,
  steerMin: 0.07,
  /** Wheel angle slew rates, rad/s (turning in / returning to centre). */
  steerRate: 2.6,
  steerReturnRate: 4.5,

  // ── Brakes / reverse ─────────────────────────────────────────────────────────────────────
  /** Full-pedal brake force as a multiple of the car's weight. */
  brakeForceG: 1.3,
  brakeFrontShare: 0.62,
  /** Rear-axle handbrake force, N, and the rear grip multipliers while it is pulled. */
  handbrakeForceN: 9000,
  handbrakeRearFriction: 0.35,
  handbrakeRearSideStiffness: 0.55,
  /** Reverse uses this fraction of the engine torque, up to reverseMaxSpeed m/s. */
  reverseTorqueRatio: 0.45,
  reverseMaxSpeed: 9,
  /** Below this forward speed the brake pedal engages reverse, m/s. */
  reverseEngageSpeed: 1.2,
  /** With no pedal input below this speed the brakes hold the car still, m/s. */
  idleHoldSpeed: 0.5,
  /** Both pedals below burnoutMaxSpeed m/s: rear longitudinal grip × this ("clutch dump") so the rears light up at any tier. */
  burnoutRearGrip: 0.4,
  burnoutMaxSpeed: 4,

  // ── Suspension damping (scaled with the per-axle stiffness so balance changes stay consistent) ──
  /** Rapier damping = ratio × √stiffness (≈ fraction of critical for a quarter-car). */
  dampingCompressionRatio: 0.5,
  dampingRelaxationRatio: 0.75,

  // ── Airborne body aerodynamics ───────────────────────────────────────────────────────────
  // The protocol's aero couple (front lift + rear downforce) is applied in flight too, so the
  // car pitches with its settings. The body itself is aerodynamically stable like a dart:
  // a restoring moment toward the flight path and pitch-rate damping keep long jumps
  // flyable with good settings. Only active with all four wheels off the ground.
  /** Restoring pitch moment = airPitchStiffness · v² · sin(angle of attack), N·m. */
  airPitchStiffness: 60,
  /** Pitch-rate damping = (airPitchDamping · |v| + airPitchDampingBase) · ω_pitch, N·m. */
  airPitchDamping: 55,
  airPitchDampingBase: 300,
  /** Roll-rate damping in the air, N·m per rad/s. */
  airRollDamping: 500,
  /** Seconds after take-off over which the airborne moments fade in. */
  airBlendTime: 0.2,

  // ── Telemetry thresholds ─────────────────────────────────────────────────────────────────
  /** Combined slip speed where slip01 starts rising / reaches 1, m/s. */
  slipStart: 1.2,
  slipFull: 7,
  /** Nose-lift flag needs this forward speed (m/s) and both front wheels off for noseLiftDebounce s. */
  noseLiftMinSpeed: 11,
  noseLiftDebounce: 0.12,
} as const;
