import { useEffect, useRef, useState } from 'react';
import { carRuntime } from '../car/runtime';
import { onGameEvent } from '../game/events';
import { useGameStore } from '../state/store';
import { formatRaceTime, toggleClass, useRafLoop } from './hudUtils';

interface Flash {
  id: number;
  text: string;
  tone: 'bad' | 'good' | 'info';
}

/** Centre-screen callouts: nose-lift warning, falls, checkpoints, finish. */
export function Banners() {
  const finished = useGameStore((s) => s.run.finished);
  // Only the final time matters here; avoids re-rendering with the 10 Hz timer mirror.
  const elapsed = useGameStore((s) => (s.run.finished ? s.run.elapsedMs : 0));
  const best = useGameStore((s) => s.run.bestMs);
  const [flash, setFlash] = useState<Flash | null>(null);
  const liftRef = useRef<HTMLDivElement>(null);

  useRafLoop(() => toggleClass(liftRef.current, 'is-visible', carRuntime.noseLift));

  useEffect(() => {
    let id = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (text: string, tone: Flash['tone']) => {
      setFlash({ id: ++id, text, tone });
      clearTimeout(timer);
      timer = setTimeout(() => setFlash(null), 1600);
    };
    const offs = [
      onGameEvent('respawn', ({ reason }) => {
        if (reason === 'fall') show('LOST TO THE VOID', 'bad');
        else if (reason === 'flipped') show('FLIP RECOVERY', 'info');
      }),
      onGameEvent('checkpoint', ({ index, elapsedMs }) => show(`CHECKPOINT ${index} · ${formatRaceTime(elapsedMs)}`, 'good')),
    ];
    return () => {
      offs.forEach((off) => off());
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="hud-banners">
      <div className="hud-banner hud-banner--lift" ref={liftRef} data-testid="nose-lift-banner">
        NOSE LIFT · ADD FRONT WING
      </div>
      {flash && (
        <div key={flash.id} className={`hud-banner hud-banner--${flash.tone} is-visible is-pop`}>
          {flash.text}
        </div>
      )}
      {finished && (
        <div className="hud-banner hud-banner--finish is-visible">
          FINISH {formatRaceTime(elapsed)}
          <small>{best !== null && best === elapsed ? 'NEW BEST' : `BEST ${formatRaceTime(best)}`} · T TO RESTART</small>
        </div>
      )}
    </div>
  );
}
