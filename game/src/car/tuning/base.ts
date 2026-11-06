/**
 * The base handling table: the hypercar's values, which are every class's defaults. A class
 * overrides what makes it feel different in its own module next to this file (tuning/<id>.ts);
 * tuning.ts merges them into one `CarTuning` per class for vehicleSpec.ts.
 *
 * None of these is part of the wire protocol (those live in shared/protocol.ts and arrive live
 * from the dashboard).
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

  // ── Ground effect ────────────────────────────────────────────────────────────────────────
  // The protocol's aero terms (front wing + body lift at the front axle, rear wing at the rear
  // axle) are treated as ground-effect aero: each axle's force is full strength while that axle's
  // tyres touch or the surface is close below it, and fades once the axle is high above the
  // ground or over the void. Without this, wing setting would change the gravity a car "feels" in
  // flight by up to ±0.2 g and lever it up at the lip, so the big jump's required lip speed would
  // depend on aero and BIG_JUMP_LIP_KMH could not be one honest number. Drag is unaffected.
  /** Fraction of the aero forces left far from the ground. */
  groundEffectMin: 0,
  /** Rise above normal ride height that still counts as "on the ground" (covers a ~20° wheelie), m. */
  groundEffectFullRise: 1.0,
  /** e-folding height of the fade beyond groundEffectFullRise, m. */
  groundEffectHeight: 0.6,
  /** Downward probe length below an axle, m (beyond it: no ground). */
  groundEffectRange: 14,
  /** Smoothing time constant, s (about one step: a lip edge is a genuine step). */
  groundEffectTau: 0.02,

  /**
   * 1 = vertical aero acts perpendicular to the velocity instead of along chassis −up. 0 for the
   * hypercar (its big-jump calibration was made that way); the newer classes use 1 so a car pitched
   * by heavy downforce doesn't get a forward push from its own wings.
   */
  aeroNormalToFlow: 0,

  // ── Telemetry thresholds ─────────────────────────────────────────────────────────────────
  /** Combined slip speed where slip01 starts rising / reaches 1, m/s. */
  slipStart: 1.2,
  slipFull: 7,
  /** Nose-lift flag needs this forward speed (m/s) and both front wheels off for noseLiftDebounce s. */
  noseLiftMinSpeed: 11,
  noseLiftDebounce: 0.12,
  /**
   * …and net front lift ≥ this fraction of the static front-axle load. A genuine lift-off happens
   * at ≥ 57 % (full-throttle load transfer covers the rest); bounces at low speed never get there.
   */
  noseLiftMinLiftRatio: 0.5,
} as const;
