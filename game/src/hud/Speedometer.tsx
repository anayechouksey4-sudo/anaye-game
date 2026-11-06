import { useRef } from 'react';
import { estimateTopSpeedKmh, type CarPhysicsParams } from '@shared/protocol';
import { engineReadout, gearLabel } from '../audio/engineReadout';
import { carRuntime } from '../car/runtime';
import { gameState } from '../state/store';
import { setFill, setText, toggleClass, useRafLoop } from './hudUtils';

export function Speedometer() {
  // Read in the rAF loop rather than subscribed, so slider drags don't re-render the gauge.
  const topRef = useRef({ physics: null as CarPhysicsParams | null, carId: '', kmh: Infinity });
  const estRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useRafLoop(() => {
    const { physics, carId } = gameState();
    const top = topRef.current;
    if (top.physics !== physics || top.carId !== carId) {
      top.physics = physics;
      top.carId = carId;
      top.kmh = estimateTopSpeedKmh(physics, carId);
      setText(estRef.current, `EST TOP ${Number.isFinite(top.kmh) ? Math.round(top.kmh) : '∞'} KM/H`);
    }
    const topKmh = top.kmh;
    const kmh = carRuntime.speedKmh;
    setText(speedRef.current, String(Math.round(kmh)));
    setFill(barRef.current, Number.isFinite(topKmh) && topKmh > 0 ? kmh / topKmh : 0);
    setText(gearRef.current, carRuntime.reversing ? 'R' : carRuntime.wheelsGrounded === 0 && carRuntime.ready ? 'AIR' : gearLabel(engineReadout));
    toggleClass(rootRef.current, 'is-redline', Number.isFinite(topKmh) && kmh > topKmh * 0.97);
  });

  return (
    <div className="hud-panel hud-speedo" ref={rootRef}>
      <div className="hud-speedo__row">
        <span className="hud-speedo__gear" ref={gearRef}>
          N
        </span>
        <span className="hud-speedo__value" ref={speedRef} data-testid="hud-speed">
          0
        </span>
        <span className="hud-speedo__unit">KM/H</span>
      </div>
      <div className="hud-bar hud-bar--speed" ref={barRef} />
      <div className="hud-speedo__est" ref={estRef} />
    </div>
  );
}
