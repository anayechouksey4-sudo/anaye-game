/**
 * CLOUDBREAK ISLES — floating voxel islands in a bright sky. Four island hops get longer and drop
 * further each time (10 → 16 → 24 → 32 m), with a crumbling tile bridge and a pendulum island in
 * between, then the runway isle: a dead-straight 520 m run-up to the CLOUDBREAK LEAP, a 90 m gap
 * to a knoll 6 m below a 12° lip (4.3 m tall kicker).
 *
 * Lip speed it takes, measured in the sim with the hypercar: from a standstill at the leap's
 * checkpoint, full throttle, Engine Torque swept at fixed wing (lip speed → outcome):
 *   10 % wing  154.0 falls · 155.8 clears        60 % wing  158.3 falls · 158.8 / 159.4 clear
 *   30 % wing  155.8 falls · 156.7 clears        80 % wing  158.8 falls · 159.9 clears
 * More wing = more drag in flight, so the edge rises with wing; 160 at the lip clears at every
 * setting tried. Stock setups (balance 0): tier 3 never makes it (best lip 148.8 at 0 %, 144.9 at
 * 10 %); tier 4 clears at 10–40 % wing (lip 168.6 · 164.6 · 161.1 · 157.7) and falls at 0 % (152.3)
 * / 50 % (154.2); tier 5 clears from 0 % (160.1) to 80 % (162.3) and falls at 100 % (155.8).
 *
 * REQUIRED_KMH = 163, not 160: it is also the ESTIMATED top speed the dashboard's assessBigJump
 * asks for, and the 520 m run-up (chaos: 825 m) leaves a car 5–6 km/h below its top speed at the
 * lip. Integration pass, hypercar from the checkpoint (estimated top → lip → outcome): 44/4/0
 * 161.6 → 156.2 short, 94/5/0 162.6 → 157.6 short, 40/4/−40 163.1 → 157.2 clears, 39/4/0 163.5 →
 * 158.0 clears. Rally (needs 163 × 1.027): 165.6 short, 166.5 clears; muscle and formula clear
 * 1–3 km/h under their scaled requirement (conservative). So the sign overstates the lip speed a
 * little: about 160 at the lip lands (160.5 to be sure, see below).
 * Landing speed (catalog landKmh / landKmhByCar, what the dashboard's speed trap judges against),
 * protocol-fix pass, same method, wing swept to the edge: hypercar tier 5 at 80–90 % wing →
 * 162.4 · 161.0 · 160.6 · 160.3 clear, 160.0 (87 %) falls, 159.7 (88 %) clears, 159.0 (90 %) falls —
 * so it lands from 160.5 (87 % and 90 % wing are estimated READY yet fell: the estimate is a little
 * optimistic at extreme wing). Rally 160.3 fell once and cleared once, 160.7+ always → 160.5;
 * muscle 156.1 fell, 156.5+ always clears (155.3 and 155.9 also did) → 156.5; formula tier 5 at
 * 45–50 % wing fell up to 164.3, 165.0+ always clears (tier 4 at 20–23 % lands from 161.6) → 164.5.
 * Full-course autopilot (hops at a ballistic target speed, hazards timed): 30/5/0 → 49.3 s, lip
 * 182.3 km/h; 30/4/0 → 51.4 s, lip 162.7 km/h; 0 falls.
 */
import { BIG_JUMP } from '../chaos/config';
import { tunings, type TrackRecipe } from '../chaos/recipe';
import { rockUnderIslands } from './helpers';

const WIDTH = 18;

/** Island hops: gap, lip angle, landing drop, landing deck length (m / °). */
const HOPS = [
  { gapM: 10, lipAngleDeg: 6, dropM: 1.5, landingLength: 36 },
  { gapM: 16, lipAngleDeg: 7, dropM: 2.5, landingLength: 40 },
  { gapM: 24, lipAngleDeg: 8, dropM: 3, landingLength: 44 },
  { gapM: 32, lipAngleDeg: 9, dropM: 4, landingLength: 48 },
] as const;

export const ISLES_RECIPE: TrackRecipe = {
  id: 'isles',
  name: 'Cloudbreak Isles',
  seed: 4242,
  title: 'CLOUDBREAK ISLES',
  width: WIDTH,
  tunings: tunings(WIDTH, {
    gap: { approachDeg: [2, 4], pieceLength: 5 },
    tiles: { exitLength: 16 },
    pendulum: { countMin: 3, countMax: 3, gantryHalfSpan: 14 },
  }),
  bigJump: {
    ...BIG_JUMP,
    RUNUP_M: 520,
    LANE_SHIFT_M: 0,
    LANE_SHIFT_LENGTH_M: 0,
    LANE_SHIFT_END_BEFORE_KICKER_M: 150,
    RUNUP_WIDTH: WIDTH,
    KICKER_WIDTH: 16,
    KICKER_PROFILE: [
      { angleDeg: 2.5, length: 6 },
      { angleDeg: 5, length: 6 },
      { angleDeg: 7.5, length: 6 },
      { angleDeg: 10, length: 6 },
      { angleDeg: 12, length: 8 },
    ],
    GAP_M: 90,
    LANDING_DROP_M: 6,
    LANDING_WIDTH: 22,
    REQUIRED_KMH: 163,
    TITLE: 'CLOUDBREAK LEAP',
    RUNUP_HINT: '520 M RUN-UP · TIER 4+',
  },
  palette: {
    glow: { cyan: '#2EF2C8', magenta: '#FF5FA8', yellow: '#FFD23F', green: '#8CFF4F', orange: '#FF9A2E' },
    tile: { start: '#7d8a7a', deck: '#4d8f45', stripes: '#4d8f45', hazard: '#9c8758', ramp: '#a0683f', landing: '#5aa04f', finish: '#7d8a7a' },
    tileAccent: '#7fcf62',
    tileAccentRamp: '#c08050',
    slab: '#4a3424',
    steel: '#5b5f6b',
    solid: '#5a4330',
    panel: '#1d2430',
    post: '#3b4250',
    gantry: '#4a505c',
    hazard: { tile: '#8a7a5a', bob: '#3c4a5a', stud: '#2c3644', arm: '#3a404c', wall: '#5a4a3a' },
    surface: { roughness: 0.85, metalness: 0.05 },
    rock: ['#7a5c3e', '#654a32', '#523c29', '#3f2e20'],
  },
  decor: {
    debrisCount: 110,
    billboardEvery: 260,
    debrisColors: ['#ffffff', '#f4f7ff', '#fde9f1', '#eaf3ff'],
    debrisGlows: ['#ffffff'],
    debrisStyle: 'clouds',
    billboardText: ['CLOUDBREAK ISLES', 'SEND IT', 'LAND IT CLEAN'],
    billboardGlow: 'magenta',
  },
  atmosphere: {
    background: '#8ec9ff',
    fog: ['#bfe3ff', 140, 950],
    hemisphere: ['#ffffff', '#6b8fb5', 0.95],
    ambient: 0.35,
    sun: { color: '#fff1d6', intensity: 2.1 },
    stars: 0,
    voidGrid: null,
  },
  compose(b) {
    b.pylons = false;
    const [h1, h2, h3, h4] = HOPS;
    b.start(64, 0);
    b.straight(32);
    b.gap({ ...h1, label: `ISLAND HOP ${h1.gapM} m` });
    b.leadIn(56, `HOP ${h2.gapM} M`);
    b.gap({ ...h2, label: `ISLAND HOP ${h2.gapM} m` });
    b.leadIn(48, 'CRUMBLE BRIDGE');
    b.tiles({ cols: 3, rows: 10 });
    b.straight(36);
    b.leadIn(72, `HOP ${h3.gapM} M`);
    b.gap({ ...h3, label: `ISLAND HOP ${h3.gapM} m` });
    b.leadIn(40, 'PENDULUM ISLE');
    b.pendulums({ count: 3 });
    b.leadIn(88, `HOP ${h4.gapM} M`);
    b.gap({ ...h4, label: `ISLAND HOP ${h4.gapM} m` });
    b.bigJump();
    rockUnderIslands(b);
  },
};
