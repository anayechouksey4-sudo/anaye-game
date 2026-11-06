/**
 * GamerFleet Chaos Track recipe — the original map. Uses the config.ts constants unchanged, so
 * `generateChaosTrack(1337)` is the hand-validated layout (README "GamerFleet Chaos Track"):
 *
 *   START ─ [connector] ─ CP ▸ hazard ─ connector ─ CP ▸ hazard ─ … (4 hazards, seeded order) ─ CP ▸ THE MASSIVE JUMP ─ FINISH
 */
import { CHAOS_TRACK_ID, CONNECTOR, DECK, DEFAULT_CHAOS_SEED } from '../chaos/config';
import type { HazardKind } from '../chaos/plan';
import { CHAOS_BIG_JUMP, CHAOS_DECOR, CHAOS_PALETTE, CHAOS_TUNINGS, CHAOS_WIDTH, HAZARD_LABEL, type TrackRecipe } from '../chaos/recipe';
import { pick, shuffle, stepped } from '../chaos/rng';

const HAZARDS: readonly HazardKind[] = ['gap', 'tiles', 'pendulums', 'sliders'];

export const CHAOS_RECIPE: TrackRecipe = {
  id: CHAOS_TRACK_ID,
  name: 'GamerFleet Chaos Track',
  seed: DEFAULT_CHAOS_SEED,
  title: 'GAMERFLEET CHAOS TRACK',
  width: CHAOS_WIDTH,
  tunings: CHAOS_TUNINGS,
  bigJump: CHAOS_BIG_JUMP,
  palette: CHAOS_PALETTE,
  decor: CHAOS_DECOR,
  compose(b, rng) {
    b.start(64, 0);
    const order = shuffle(rng, HAZARDS);
    // At least one chicane per layout; which connector gets it is seeded (never the one right after the gap).
    const chicaneSlots = order.map((_, i) => i).filter((i) => i > 0 && order[i - 1] !== 'gap');
    const forcedChicane = pick(rng, chicaneSlots);
    order.forEach((hazard, i) => {
      const connector = i === 0 ? rng() < 0.5 : true;
      // Fast cars fly far off the sky gap: what follows it stays straight.
      const afterGap = order[i - 1] === 'gap';
      if (connector || i === forcedChicane) {
        const chicane = !afterGap && (i === forcedChicane || rng() < 0.45);
        if (chicane) {
          let shift = stepped(rng, CONNECTOR.shiftMin, CONNECTOR.shiftMax, 1) * (rng() < 0.5 ? -1 : 1);
          if (Math.abs(b.x + shift) > CONNECTOR.maxOffset) shift = -shift;
          b.chicane(stepped(rng, CONNECTOR.chicaneMin, CONNECTOR.chicaneMax, DECK.tile), shift);
        } else {
          b.straight(stepped(rng, CONNECTOR.straightMin, CONNECTOR.straightMax, DECK.tile));
        }
      }
      b.leadIn(CHAOS_TUNINGS.leadIn[hazard], HAZARD_LABEL[hazard]);
      b[hazard]();
    });
    b.bigJump();
  },
};
