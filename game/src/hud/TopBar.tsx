import { useRef } from 'react';
import { estimateTopSpeedKmh, type CarPhysicsParams } from '@shared/protocol';
import { engineReadout, gearLabel } from '../audio/engineReadout';
import { carRuntime } from '../car/runtime';
import { runClock } from '../game/runClock';
import { gameState, useGameStore } from '../state/store';
import { formatRaceTime, setFill, setText, toggleClass, useRafLoop } from './hudUtils';

/**
 * Phone HUD (compact): speed, gear, run timer and checkpoints in one slim bar at the top edge, so
 * nothing sits over the car, the road ahead or the thumbs. Numbers are written from rAF into DOM
 * refs (no 60 Hz React renders). The desktop layout keeps the big speedometer at the bottom.
 */
export function TopBar() {
  const checkpoint = useGameStore((s) => s.run.checkpoint);
  const total = useGameStore((s) => s.run.totalCheckpoints);
  const finished = useGameStore((s) => s.run.finished);
  const started = useGameStore((s) => s.run.started);
  const topRef = useRef({ physics: null as CarPhysicsParams | null, carId: '', kmh: Infinity });
  const rootRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const gearRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<HTMLSpanElement>(null);

  useRafLoop(() => {
    const s = gameState();
    const top = topRef.current;
    if (top.physics !== s.physics || top.carId !== s.carId) {
      top.physics = s.physics;
      top.carId = s.carId;
      top.kmh = estimateTopSpeedKmh(s.physics, s.carId);
    }
    const kmh = carRuntime.speedKmh;
    setText(speedRef.current, String(Math.round(kmh)));
    setFill(barRef.current, Number.isFinite(top.kmh) && top.kmh > 0 ? kmh / top.kmh : 0);
    // The gear the engine sound is in (audio/engineReadout.ts, updated even while muted), so the
    // number on screen matches what the player hears; AIR while all four wheels are off the ground.
    setText(gearRef.current, carRuntime.reversing ? 'R' : carRuntime.wheelsGrounded === 0 && carRuntime.ready ? 'AIR' : gearLabel(engineReadout));
    toggleClass(rootRef.current, 'is-redline', Number.isFinite(top.kmh) && kmh > top.kmh * 0.97);
    setText(timerRef.current, formatRaceTime(s.run.finished ? s.run.elapsedMs : runClock.elapsedMs));
  });

  const timerClass = `hud-topbar__timer${finished ? ' is-finished' : started ? ' is-running' : ''}`;
  return (
    <div className="hud-panel hud-topbar" ref={rootRef} data-testid="top-bar">
      <div className="hud-topbar__speed">
        <span className="hud-topbar__value" ref={speedRef} data-testid="hud-speed">
          0
        </span>
        <span className="hud-topbar__side">
          <span className="hud-topbar__gear" ref={gearRef}>
            N
          </span>
          <span className="hud-topbar__unit">KM/H</span>
        </span>
        <div className="hud-bar hud-bar--speed hud-topbar__bar" ref={barRef} />
      </div>
      <div className="hud-topbar__run" data-testid="run-panel">
        <span className={timerClass} ref={timerRef}>
          0:00.000
        </span>
        <span className="hud-topbar__cp">
          <label>CP</label>
          <b data-testid="hud-checkpoint">
            {checkpoint}/{total}
          </b>
        </span>
      </div>
    </div>
  );
}
