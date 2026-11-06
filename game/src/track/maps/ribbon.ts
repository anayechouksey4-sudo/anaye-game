/**
 * NEON RIBBON — a short, technical map at dusk. A narrow 10 m ribbon swings left-right in
 * continuous S-bends (staircase chicanes in alternating directions, so their curvature joins up),
 * broken by two sets of fast shutter gates and one small hop. No big jump: the time is made by
 * braking early, carrying speed through the bends and reading the shutter rhythm.
 */
import { tunings, type TrackRecipe } from '../chaos/recipe';
import { sBends } from './helpers';

const WIDTH = 10;

export const RIBBON_RECIPE: TrackRecipe = {
  id: 'ribbon',
  name: 'Neon Ribbon',
  seed: 777,
  title: 'NEON RIBBON',
  width: WIDTH,
  tunings: tunings(WIDTH, {
    connector: { chicaneMin: 36, chicaneMax: 48, shiftMin: 8, shiftMax: 12, maxOffset: 6, sliceLength: 2 },
    // Quicker shutters on a narrower span, timed for a car at ~65 km/h.
    sliders: { periodMin: 3.0, periodMax: 3.4, countMin: 3, countMax: 3, spacingMin: 14, spacingMax: 18, designSpeed: 18, entryLength: 12, exitLength: 16 },
    gap: { approachDeg: [2, 4], lipAnglesDeg: [6], lengths: [8], landingLength: 44 },
  }),
  palette: {
    glow: { cyan: '#FF9E3D', magenta: '#FF3DD8', yellow: '#FFE45C', green: '#5CFFB1', orange: '#FF5E2A' },
    tile: { start: '#2f2340', deck: '#3a2346', stripes: '#3a2346', hazard: '#47213f', ramp: '#52224a', landing: '#253842', finish: '#2f2340' },
    tileAccent: '#5c3570',
    tileAccentRamp: '#6e2a5e',
    slab: '#120a1a',
    steel: '#22182e',
    solid: '#1a0f22',
    panel: '#140c1c',
    post: '#221a2e',
    gantry: '#2a1838',
    hazard: { tile: '#3a2440', bob: '#3a1236', stud: '#4a1a44', arm: '#2a1a30', wall: '#2a1a30' },
    surface: { roughness: 0.6, metalness: 0.22 },
  },
  decor: {
    debrisCount: 130,
    billboardEvery: 200,
    debrisColors: ['#2a1838', '#3a1c3e', '#1f1a3a', '#40243a'],
    debrisGlows: ['#FF9E3D', '#FF3DD8', '#FFE45C'],
    debrisStyle: 'voxels',
    billboardText: ['HOLD THE LINE', 'NEON RIBBON', 'BRAKE · TURN · SEND'],
    billboardGlow: 'cyan',
  },
  atmosphere: {
    background: '#1b0a2a',
    fog: ['#2a0f38', 70, 560],
    hemisphere: ['#ffb27a', '#2a0838', 0.8],
    ambient: 0.2,
    sun: { color: '#ffc08a', intensity: 1.5 },
    stars: 1,
    voidGrid: ['#ff9e3d', '#3a1238'],
  },
  compose(b, rng) {
    b.start(64, 0);
    sBends(b, rng, 3);
    b.leadIn(36, 'SHUTTER GATES');
    b.sliders();
    sBends(b, rng, 3);
    b.leadIn(44, 'HOP');
    b.gap();
    sBends(b, rng, 2);
    b.leadIn(36, 'SHUTTER GATES');
    b.sliders();
    sBends(b, rng, 3);
    b.finishStraight(72, 28);
  },
};
