/**
 * MIDNIGHT STRIP — a 1 km drag strip under a night skyline. Flat out from the line: checkpoints
 * at 400 m and 800 m, the finish at 1000 m, then a 400 m braking zone and an end wall. Best for
 * top-speed and launch tuning (Engine Tier + low wing, without lifting the nose).
 */
import { tunings, type TrackRecipe } from '../chaos/recipe';
import { distanceBars, edgeLights } from './helpers';

const WIDTH = 24;

export const STRIP_RECIPE: TrackRecipe = {
  id: 'strip',
  name: 'Midnight Strip',
  seed: 1000,
  title: 'MIDNIGHT STRIP',
  width: WIDTH,
  tunings: tunings(WIDTH),
  palette: {
    glow: { cyan: '#8F7DFF', magenta: '#FF2A6D', yellow: '#FFFFFF', green: '#39FF14', orange: '#FF8A1F' },
    tile: { start: '#1a1a24', deck: '#15151d', stripes: '#15151d', hazard: '#221a2a', ramp: '#2a1a30', landing: '#152226', finish: '#1a1a24' },
    tileAccent: '#262634',
    tileAccentRamp: '#3a2440',
    slab: '#08080c',
    steel: '#14141c',
    solid: '#0e0c14',
    panel: '#0a0a10',
    post: '#16161e',
    gantry: '#1a1626',
    hazard: { tile: '#2a2238', bob: '#2a1030', stud: '#3a1640', arm: '#1d1a26', wall: '#1b1724' },
    surface: { roughness: 0.5, metalness: 0.3 },
  },
  decor: {
    debrisCount: 120,
    billboardEvery: 180,
    debrisColors: ['#1a1830', '#221e3a', '#16142a', '#2a2140'],
    debrisGlows: ['#8F7DFF', '#FF2A6D', '#2EE6FF'],
    debrisStyle: 'towers',
    billboardText: ['MIDNIGHT STRIP', 'FLAT OUT', 'TOP SPEED'],
    billboardGlow: 'magenta',
  },
  atmosphere: {
    background: '#03030a',
    fog: ['#07061a', 60, 700],
    hemisphere: ['#9a8cff', '#0a0418', 0.5],
    ambient: 0.14,
    sun: { color: '#cfc6ff', intensity: 1.1 },
    stars: 1,
    voidGrid: ['#7a5cff', '#160b34'],
  },
  compose(b) {
    b.start(64, 0);
    const lights = b.glow('yellow');
    edgeLights(b, -20, 1380, 20, lights);
    distanceBars(b, 100, 900, 100, b.glow('cyan'));
    b.straight(376);
    b.checkpoint(400, b.x, b.width, '400 M', 'cyan');
    b.straight(400);
    b.checkpoint(800, b.x, b.width, '800 M', 'magenta');
    b.straight(144);
    b.finishStraight(440, 40);
    b.sign({ id: 'strip-start', lines: ['MIDNIGHT STRIP', '1000 M · FLAT OUT'], position: [-(b.width / 2 + 10), 7, 70], yaw: Math.PI - 0.35, width: 15, height: 5.5, color: 'magenta' });
    b.sign({ id: 'strip-brake', lines: ['BRAKE ZONE', '400 M TO THE WALL'], position: [b.width / 2 + 10, 7, 960], yaw: Math.PI + 0.35, width: 15, height: 5.5, color: 'yellow' });
  },
};
