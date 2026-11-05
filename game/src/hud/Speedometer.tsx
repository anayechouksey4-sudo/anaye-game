import { useMemo, useRef } from 'react';
import { estimateTopSpeedKmh } from '@shared/protocol';
import { carRuntime } from '../car/runtime';
import { useGameStore } from '../state/store';
import { setFill, setText, toggleClass, useRafLoop } from './hudUtils';

export function Speedometer() {
  const physics = useGameStore((s) => s.physics);
  const topKmh = useMemo(() => estimateTopSpeedKmh(physics), [physics]);
  const speedRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useRafLoop(() => {
    const kmh = carRuntime.speedKmh;
    setText(speedRef.current, String(Math.round(kmh)));
    setFill(barRef.current, Number.isFinite(topKmh) && topKmh > 0 ? kmh / topKmh : 0);
    setText(gearRef.current, carRuntime.reversing ? 'R' : carRuntime.wheelsGrounded === 0 && carRuntime.ready ? 'AIR' : 'D');
    toggleClass(rootRef.current, 'is-redline', Number.isFinite(topKmh) && kmh > topKmh * 0.97);
  });

  return (
    <div className="hud-panel hud-speedo" ref={rootRef}>
      <div className="hud-speedo__row">
        <span className="hud-speedo__gear" ref={gearRef}>
          D
        </span>
        <span className="hud-speedo__value" ref={speedRef} data-testid="hud-speed">
          0
        </span>
        <span className="hud-speedo__unit">KM/H</span>
      </div>
      <div className="hud-bar hud-bar--speed" ref={barRef} />
      <div className="hud-speedo__est">EST TOP {Number.isFinite(topKmh) ? Math.round(topKmh) : '∞'} KM/H</div>
    </div>
  );
}
