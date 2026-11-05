import { useMemo, useRef } from 'react';
import { assessBigJump } from '@shared/protocol';
import { carRuntime } from '../car/runtime';
import { useGameStore } from '../state/store';
import { formatKiloNewton, setFill, setText, toggleClass, useRafLoop } from './hudUtils';

/** Scale for the aero bars: ±this many newtons fills the bar. */
const AERO_FULL_SCALE = 15000;

export function TelemetryPanel() {
  const physics = useGameStore((s) => s.physics);
  const jump = useMemo(() => assessBigJump(physics), [physics]);
  const refs = {
    throttle: useRef<HTMLDivElement>(null),
    brake: useRef<HTMLDivElement>(null),
    front: useRef<HTMLDivElement>(null),
    frontVal: useRef<HTMLElement>(null),
    frontRow: useRef<HTMLDivElement>(null),
    rear: useRef<HTMLDivElement>(null),
    rearVal: useRef<HTMLElement>(null),
    slip: useRef<HTMLDivElement>(null),
    slipVal: useRef<HTMLElement>(null),
    loadF: useRef<HTMLElement>(null),
    loadR: useRef<HTMLElement>(null),
    wheels: useRef<HTMLDivElement>(null),
  };

  useRafLoop(() => {
    const rt = carRuntime;
    setFill(refs.throttle.current, rt.throttle);
    setFill(refs.brake.current, rt.brake);
    // Centre-zero bars: right of centre = downforce, left = lift.
    setFill(refs.front.current, 0.5 + rt.frontAeroN / AERO_FULL_SCALE / 2);
    setFill(refs.rear.current, 0.5 + rt.rearAeroN / AERO_FULL_SCALE / 2);
    setText(refs.frontVal.current, `${formatKiloNewton(rt.frontAeroN)} kN`);
    setText(refs.rearVal.current, `${formatKiloNewton(rt.rearAeroN)} kN`);
    toggleClass(refs.frontRow.current, 'is-lift', rt.frontAeroN < -250);
    toggleClass(refs.frontRow.current, 'is-nose-up', rt.noseLift);
    setFill(refs.slip.current, rt.rearSlip);
    setText(refs.slipVal.current, `${Math.round(rt.rearSlip * 100)}%`);
    const total = rt.frontAxleLoadN + rt.rearAxleLoadN;
    const frontPct = total > 1 ? Math.round((rt.frontAxleLoadN / total) * 100) : 0;
    setText(refs.loadF.current, `${(rt.frontAxleLoadN / 1000).toFixed(1)} kN · ${frontPct}%`);
    setText(refs.loadR.current, `${(rt.rearAxleLoadN / 1000).toFixed(1)} kN · ${total > 1 ? 100 - frontPct : 0}%`);
    const wheelEls = refs.wheels.current?.children;
    if (wheelEls) {
      rt.wheels.forEach((w, i) => {
        const el = wheelEls[i] as HTMLElement | undefined;
        toggleClass(el ?? null, 'is-down', w.inContact);
        toggleClass(el ?? null, 'is-slip', w.slip01 > 0.35);
      });
    }
  });

  return (
    <div className="hud-panel hud-telemetry" data-testid="telemetry-panel">
      <div className="hud-panel__title">F1 TELEMETRY</div>
      <div className="hud-pedals">
        <div className="hud-pedal">
          <div className="hud-vbar hud-vbar--throttle" ref={refs.throttle} />
          <label>THR</label>
        </div>
        <div className="hud-pedal">
          <div className="hud-vbar hud-vbar--brake" ref={refs.brake} />
          <label>BRK</label>
        </div>
        <div className="hud-wheels" ref={refs.wheels} title="Tyre contact (green) / slip (magenta)">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="hud-tele-row" ref={refs.frontRow}>
        <label>FRONT AERO</label>
        <div className="hud-bar hud-bar--center" ref={refs.front} />
        <b ref={refs.frontVal}>0.0 kN</b>
        <span className="hud-lift-tag">LIFT</span>
      </div>
      <div className="hud-tele-row">
        <label>REAR AERO</label>
        <div className="hud-bar hud-bar--center" ref={refs.rear} />
        <b ref={refs.rearVal}>0.0 kN</b>
      </div>
      <div className="hud-tele-row">
        <label>REAR SLIP</label>
        <div className="hud-bar hud-bar--magenta" ref={refs.slip} />
        <b ref={refs.slipVal}>0%</b>
      </div>
      <div className="hud-tele-loads">
        <div>
          <label>FRONT AXLE</label>
          <b ref={refs.loadF}>—</b>
        </div>
        <div>
          <label>REAR AXLE</label>
          <b ref={refs.loadR}>—</b>
        </div>
      </div>
      <div className={`hud-jump hud-jump--${jump.verdict.replace(' ', '-').toLowerCase()}`} title="Static estimate from shared/protocol.ts">
        <label>BIG JUMP</label>
        <b>{jump.verdict}</b>
        <span>
          top {Math.round(jump.topSpeedKmh)} · lift {jump.liftOffKmh === null ? 'never' : Math.round(jump.liftOffKmh)} · need {jump.requiredKmh}
        </span>
      </div>
    </div>
  );
}
