import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { emitHapticCue } from '../audio/haptics';
import { carRuntime } from '../car/runtime';
import { onGameEvent } from '../game/events';
import { gameState } from '../state/store';
import { useWorldHud, worldLive } from '../state/worldRuntime';
import { formatRaceTime, toggleClass, useRafLoop } from './hudUtils';

interface Flash {
  id: number;
  text: string;
  tone: 'bad' | 'good' | 'info';
  sub?: string;
}

interface RegionCard {
  id: number;
  label: string;
  genre: string;
}

/** Free-roam event prompt: its own chunk (open worlds only). */
const EventPrompt = lazy(() => import('./EventPrompt').then((m) => ({ default: m.EventPrompt })));

/** How long a region card stays up on the first entry into a region, ms. */
const REGION_CARD_MS = 2500;

/** Genre line under a region card (open-world region labels; unknown labels get none). */
const REGION_GENRE: Readonly<Record<string, string>> = {
  'PRISM CITY': 'NEON CITY',
  'KITE BAY': 'COAST',
  'CINNABAR REACH': 'FRONTIER',
  'SHELL COVE': 'COAST',
  'PATCHWORK DOWNS': 'VOXEL VILLAGE',
  'LANTERN BAY': 'COAST',
  'THE CROWN': 'MOUNTAIN',
};

/** Regions whose card has shown this page load (one card per region per session). */
const seenRegions = new Set<string>();

/**
 * Callouts under the top bar: nose-lift warning, falls, checkpoints (the finish has its own results
 * screen). On an open world also: the event prompt at the top of the column (callouts queue under
 * it), WRONG WAY / MISSED CHECKPOINT ⟲ / STUCK? TAP ⟲ while the world raises them, splash / out of
 * bounds / unstuck respawns, air time and speed-trap results, and a region card the first time the
 * car enters each region in free roam.
 */
export function Banners() {
  const [flash, setFlash] = useState<Flash | null>(null);
  const [card, setCard] = useState<RegionCard | null>(null);
  const hasPrompt = useWorldHud((s) => s.prompt !== null);
  const liftRef = useRef<HTMLDivElement>(null);
  const wrongRef = useRef<HTMLDivElement>(null);
  const missedRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef<HTMLDivElement>(null);
  const showRef = useRef<(text: string, tone: Flash['tone'], sub?: string, ms?: number) => void>(() => {});
  const serials = useRef({ air: worldLive.air.serial, trap: worldLive.trap.serial });

  useRafLoop(() => {
    toggleClass(liftRef.current, 'is-visible', carRuntime.noseLift);
    const world = useWorldHud.getState().active;
    toggleClass(wrongRef.current, 'is-visible', world && worldLive.wrongWay);
    toggleClass(missedRef.current, 'is-visible', world && worldLive.missedGate);
    toggleClass(stuckRef.current, 'is-visible', world && worldLive.stuckHint);
    const seen = serials.current;
    if (worldLive.air.serial !== seen.air) {
      seen.air = worldLive.air.serial;
      const a = worldLive.air;
      if (world) showRef.current(`AIR ${a.seconds.toFixed(1)} S · ${Math.round(a.metres)} M`, 'info', a.best ? 'BEST' : undefined, 2200);
    }
    if (worldLive.trap.serial !== seen.trap) {
      seen.trap = worldLive.trap.serial;
      const t = worldLive.trap;
      if (world) showRef.current(`SALTGLASS TRAP ${Math.round(t.kmh)} KM/H`, 'info', t.best ? 'BEST' : undefined, 2500);
    }
  });

  useEffect(() => {
    let id = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cardTimer: ReturnType<typeof setTimeout> | undefined;
    const show = (text: string, tone: Flash['tone'], sub?: string, ms = 1600) => {
      setFlash({ id: ++id, text, tone, sub });
      clearTimeout(timer);
      timer = setTimeout(() => setFlash(null), ms);
    };
    showRef.current = show;
    const onRegion = (label: string) => {
      if (!label || seenRegions.has(label)) return;
      // Free roam only: in a race the lights, gates and route have the floor.
      if (gameState().trackLayout?.mode !== 'roam') return;
      seenRegions.add(label);
      setCard({ id: ++id, label, genre: REGION_GENRE[label] ?? '' });
      emitHapticCue('region');
      clearTimeout(cardTimer);
      cardTimer = setTimeout(() => setCard(null), REGION_CARD_MS);
    };
    const offs = [
      onGameEvent('respawn', ({ reason }) => {
        const world = useWorldHud.getState().active;
        if (reason === 'fall') show(world ? 'OFF THE MAP' : 'LOST TO THE VOID', 'bad');
        else if (reason === 'flipped') show('FLIP RECOVERY', 'info');
        else if (reason === 'water') show('SPLASH · BACK ON THE ROAD', 'bad');
        else if (reason === 'bounds') show('OUT OF BOUNDS', 'bad');
        else if (reason === 'stuck') show('UNSTUCK', 'info');
      }),
      onGameEvent('checkpoint', ({ index, elapsedMs }) => show(`CHECKPOINT ${index} · ${formatRaceTime(elapsedMs)}`, 'good')),
      // A new run's start lights take this spot under the top bar: drop a callout left from the last run.
      onGameEvent('restart', () => {
        clearTimeout(timer);
        setFlash(null);
      }),
      useWorldHud.subscribe((s, prev) => {
        if (s.regionLabel !== prev.regionLabel) onRegion(s.regionLabel);
        if (!s.active && prev.active) {
          clearTimeout(cardTimer);
          setCard(null);
        }
      }),
    ];
    onRegion(useWorldHud.getState().regionLabel);
    return () => {
      offs.forEach((off) => off());
      clearTimeout(timer);
      clearTimeout(cardTimer);
      showRef.current = () => {};
    };
  }, []);

  return (
    <div className="hud-banners">
      {hasPrompt && (
        <Suspense fallback={null}>
          <EventPrompt />
        </Suspense>
      )}
      <div className="hud-banner hud-banner--lift" ref={liftRef} data-testid="nose-lift-banner">
        NOSE LIFT · ADD FRONT WING
      </div>
      <div className="hud-banner hud-banner--bad hud-banner--flag" ref={wrongRef} data-testid="wrong-way-banner">
        WRONG WAY
      </div>
      <div className="hud-banner hud-banner--bad hud-banner--flag" ref={missedRef} data-testid="missed-banner">
        MISSED CHECKPOINT ⟲
      </div>
      <div className="hud-banner hud-banner--info hud-banner--flag" ref={stuckRef} data-testid="stuck-banner">
        STUCK? TAP ⟲
      </div>
      {flash && (
        <div key={flash.id} className={`hud-banner hud-banner--${flash.tone} is-visible is-pop`} data-testid="flash-banner">
          {flash.text}
          {flash.sub && <small>{flash.sub}</small>}
        </div>
      )}
      {card && (
        <div key={card.id} className="hud-banner hud-banner--region is-visible is-pop" data-testid="region-card">
          {card.label}
          {card.genre && <small>{card.genre}</small>}
        </div>
      )}
    </div>
  );
}
