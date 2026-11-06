import { useEffect, useRef, useState } from 'react';
import { carRuntime } from '../car/runtime';
import { onGameEvent } from '../game/events';
import { formatRaceTime, toggleClass, useRafLoop } from './hudUtils';

interface Flash {
  id: number;
  text: string;
  tone: 'bad' | 'good' | 'info';
}

/** Callouts under the top bar: nose-lift warning, falls, checkpoints (the finish has its own results screen). */
export function Banners() {
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
      // A new run's start lights take this spot under the top bar: drop a callout left from the last run.
      onGameEvent('restart', () => {
        clearTimeout(timer);
        setFlash(null);
      }),
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
    </div>
  );
}
