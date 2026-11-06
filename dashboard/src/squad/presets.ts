import { isCarClassId, type CarClassId, type SquadControls } from '../../../shared/protocol';

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  controls: SquadControls;
}

const BALANCED: Preset = {
  id: 'balanced',
  name: 'BALANCED',
  blurb: 'Factory baseline',
  controls: { frontWingAero: 50, engineTier: 3, chassisBalance: 0 },
};

const DOWNFORCE: Preset = {
  id: 'downforce',
  name: 'MAX DOWNFORCE',
  blurb: 'Glued down, slow on straights',
  controls: { frontWingAero: 100, engineTier: 2, chassisBalance: -10 },
};

const TOP_SPEED: Preset = {
  id: 'top-speed',
  name: 'TOP SPEED',
  blurb: 'Bare wing, nose goes light',
  controls: { frontWingAero: 0, engineTier: 5, chassisBalance: 10 },
};

/**
 * JUMP ATTEMPT is a different setup for each car. The hypercar keeps its classic preset; the rally,
 * muscle and formula ones are settings that cleared the chaos track's 95 m jump in game test runs.
 * test/session.test.ts checks each one against assessBigJump on both big-jump maps (chaos 183 km/h,
 * Cloudbreak Isles 163). The buggy can't reach lip speed with any setting, so its preset is simply
 * its fastest setup. The four newer cars' presets were checked in the game's sim from the jump
 * checkpoint (lip speed → outcome): coupe 30/T5/−20 clears chaos at 185.8 km/h and the Isles at
 * 179.8, drift 24/T5/0 at 189.8 / 183.0, electric 10/T5/0 at 185.9 / 173.9; the kart only ever
 * reaches the Isles lip (175.6 km/h max against chaos's 183 × 1.04), where 10/T5/−30 clears at 166.3.
 */
export const JUMP_PRESETS: { readonly [K in CarClassId]: Preset } = {
  hypercar: { id: 'jump', name: 'JUMP ATTEMPT', blurb: 'Clears the big gap', controls: { frontWingAero: 20, engineTier: 5, chassisBalance: -20 } },
  rally: { id: 'jump', name: 'JUMP ATTEMPT', blurb: 'Bare wing, weight forward', controls: { frontWingAero: 2, engineTier: 5, chassisBalance: -40 } },
  muscle: { id: 'jump', name: 'JUMP ATTEMPT', blurb: 'Just enough wing to stay down', controls: { frontWingAero: 20, engineTier: 5, chassisBalance: 0 } },
  formula: { id: 'jump', name: 'JUMP ATTEMPT', blurb: 'Light wing, needs tier 5', controls: { frontWingAero: 14, engineTier: 5, chassisBalance: 0 } },
  buggy: { id: 'jump', name: 'JUMP ATTEMPT', blurb: 'Flat out, still short of lip speed', controls: { frontWingAero: 0, engineTier: 5, chassisBalance: 0 } },
  coupe: { id: 'jump', name: 'JUMP ATTEMPT', blurb: 'Wing on, weight forward: the light nose needs it', controls: { frontWingAero: 30, engineTier: 5, chassisBalance: -20 } },
  drift: { id: 'jump', name: 'JUMP ATTEMPT', blurb: 'Enough wing to stop the slide', controls: { frontWingAero: 24, engineTier: 5, chassisBalance: 0 } },
  electric: { id: 'jump', name: 'JUMP ATTEMPT', blurb: 'Any wing up to a third works', controls: { frontWingAero: 10, engineTier: 5, chassisBalance: 0 } },
  kart: { id: 'jump', name: 'JUMP ATTEMPT', blurb: 'Isles only: the chaos jump is out of reach', controls: { frontWingAero: 10, engineTier: 5, chassisBalance: -30 } },
};

/** The four presets for a car (an unknown id gets the hypercar's). */
export function presetsFor(carId: string): readonly Preset[] {
  return [BALANCED, DOWNFORCE, TOP_SPEED, JUMP_PRESETS[isCarClassId(carId) ? carId : 'hypercar']];
}

/** The hypercar's presets. */
export const PRESETS: readonly Preset[] = presetsFor('hypercar');
