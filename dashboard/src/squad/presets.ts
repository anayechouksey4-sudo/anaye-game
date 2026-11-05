import type { SquadControls } from '../../../shared/protocol';

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  controls: SquadControls;
}

/** JUMP ATTEMPT is checked against assessBigJump in test/presets.test.ts — it must stay READY. */
export const PRESETS: readonly Preset[] = [
  {
    id: 'balanced',
    name: 'BALANCED',
    blurb: 'Factory baseline',
    controls: { frontWingAero: 50, engineTier: 3, chassisBalance: 0 },
  },
  {
    id: 'downforce',
    name: 'MAX DOWNFORCE',
    blurb: 'Glued down, slow on straights',
    controls: { frontWingAero: 100, engineTier: 2, chassisBalance: -10 },
  },
  {
    id: 'top-speed',
    name: 'TOP SPEED',
    blurb: 'Bare wing, nose goes light',
    controls: { frontWingAero: 0, engineTier: 5, chassisBalance: 10 },
  },
  {
    id: 'jump',
    name: 'JUMP ATTEMPT',
    blurb: 'Clears the big gap',
    controls: { frontWingAero: 20, engineTier: 5, chassisBalance: -20 },
  },
];
