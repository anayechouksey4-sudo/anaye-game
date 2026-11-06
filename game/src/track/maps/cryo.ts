/**
 * CRYO DRIFT — a wide 20 m ice shelf in a polar night. Surface grip 0.55: the tyres have about
 * half their usual grip, so braking distances double, the tail steps out under power and the
 * pendulums (longer arms, sweeping the whole width) and the 5-wide collapse fields punish a car
 * that arrives too fast to stop or turn. A long finish straight leaves room to stop.
 */
import { tunings, type TrackRecipe } from '../chaos/recipe';
import { sBends } from './helpers';

const WIDTH = 20;

export const CRYO_RECIPE: TrackRecipe = {
  id: 'cryo',
  name: 'Cryo Drift',
  seed: 2718,
  title: 'CRYO DRIFT',
  width: WIDTH,
  surfaceGrip: 0.55,
  tunings: tunings(WIDTH, {
    connector: { chicaneMin: 56, chicaneMax: 68, shiftMin: 10, shiftMax: 16, maxOffset: 8, sliceLength: 4 },
    // Ice: traction-limited launches need longer lead-ins.
    leadIn: { gap: 64, tiles: 64, pendulums: 56, sliders: 56 },
    // 13.5 m arms so the bobs sweep the full 20 m deck; gantries stand clear of the swing.
    pendulum: { armLength: 13.5, gantryHalfSpan: 16, countMin: 3, countMax: 4, spacingMin: 24, spacingMax: 30, designSpeed: 20, entryLength: 16, exitLength: 20 },
    tiles: { colsOptions: [5], rowsMin: 10, rowsMax: 12, exitLength: 20 },
  }),
  palette: {
    glow: { cyan: '#9DF2FF', magenta: '#7C8CFF', yellow: '#F2FBFF', green: '#5CFFD6', orange: '#FFA552' },
    tile: { start: '#55728a', deck: '#86b4cf', stripes: '#86b4cf', hazard: '#7d93c8', ramp: '#93a9d8', landing: '#78c2c6', finish: '#55728a' },
    tileAccent: '#c4ecff',
    tileAccentRamp: '#a8b8ff',
    slab: '#0e1a26',
    steel: '#2a3a4a',
    solid: '#18283a',
    panel: '#0b1520',
    post: '#2a3a4c',
    gantry: '#3a5068',
    hazard: { tile: '#6f8fb0', bob: '#2c3a5a', stud: '#3a4a70', arm: '#2a3448', wall: '#2c3a52' },
    surface: { roughness: 0.22, metalness: 0.12 },
  },
  decor: {
    debrisCount: 140,
    billboardEvery: 240,
    debrisColors: ['#a8d8f0', '#7fb4d8', '#c9ecff', '#5f8fb5'],
    debrisGlows: ['#9DF2FF', '#ffffff', '#7C8CFF'],
    debrisStyle: 'shards',
    billboardText: ['CRYO DRIFT', 'BRAKE EARLY', 'STAY FROSTY'],
    billboardGlow: 'cyan',
  },
  atmosphere: {
    background: '#061623',
    fog: ['#0b2436', 70, 600],
    hemisphere: ['#c8f6ff', '#0a1c2c', 0.85],
    ambient: 0.22,
    sun: { color: '#eafcff', intensity: 1.7 },
    stars: 1,
    voidGrid: ['#7fe9ff', '#0e2a3c'],
  },
  compose(b, rng) {
    b.start(64, 0);
    sBends(b, rng, 1);
    b.leadIn(b.recipe.tunings.leadIn.pendulums, 'PENDULUM ALLEY');
    b.pendulums({ count: 3 });
    sBends(b, rng, 1);
    b.leadIn(b.recipe.tunings.leadIn.tiles, 'COLLAPSE ZONE');
    b.tiles();
    sBends(b, rng, 2);
    b.leadIn(b.recipe.tunings.leadIn.pendulums, 'PENDULUM ALLEY');
    b.pendulums({ count: 4 });
    sBends(b, rng, 1);
    b.leadIn(b.recipe.tunings.leadIn.tiles, 'COLLAPSE ZONE');
    b.tiles();
    sBends(b, rng, 2);
    b.finishStraight(128, 40);
  },
};
