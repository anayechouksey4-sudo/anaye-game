import { useEffect, useState } from 'react';
import { CAR_PHYSICS_KEYS, CAR_PHYSICS_SPECS, type CarPhysicsKey } from '@shared/protocol';
import { useGameStore } from '../state/store';

const FLASH_MS = 900;

function decimalsFor(step: number): number {
  return Math.max(0, -Math.floor(Math.log10(step)));
}

/** Live physics tuning. Values flash when a change arrives over the squad link. */
export function PhysicsPanel() {
  const open = useGameStore((s) => s.ui.physicsPanelOpen);
  const physics = useGameStore((s) => s.physics);
  const controls = useGameStore((s) => s.controls);
  const lastChange = useGameStore((s) => s.lastPhysicsChange);
  const [flashing, setFlashing] = useState<ReadonlySet<CarPhysicsKey>>(new Set());

  useEffect(() => {
    if (!lastChange || (lastChange.source !== 'ws' && lastChange.source !== 'snapshot')) return;
    setFlashing(new Set(lastChange.keys));
    const timer = setTimeout(() => setFlashing(new Set()), FLASH_MS);
    return () => clearTimeout(timer);
  }, [lastChange]);

  if (!open) return null;
  const { patchPhysics, resetPhysics, togglePhysicsPanel } = useGameStore.getState();

  return (
    <aside className="hud-panel hud-physics" data-testid="physics-panel">
      <div className="hud-panel__title">
        PHYSICS
        <button type="button" className="hud-btn hud-btn--ghost" onClick={() => togglePhysicsPanel(false)} aria-label="Close physics panel">
          ✕
        </button>
      </div>
      {CAR_PHYSICS_KEYS.map((key) => {
        const spec = CAR_PHYSICS_SPECS[key];
        const value = physics[key];
        return (
          <label key={key} className={`hud-slider${flashing.has(key) ? ' is-flash' : ''}`} title={spec.description}>
            <span className="hud-slider__head">
              <span>{spec.label}</span>
              <b data-testid={`physics-value-${key}`}>
                {value.toFixed(decimalsFor(spec.step))}
                {spec.unit && <small> {spec.unit}</small>}
              </b>
            </span>
            <input
              type="range"
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={value}
              onChange={(e) => patchPhysics({ [key]: Number(e.currentTarget.value) }, 'local')}
            />
          </label>
        );
      })}
      <button type="button" className="hud-btn" onClick={resetPhysics}>
        RESET TO {controls ? 'SQUAD SETUP' : 'DEFAULTS'}
      </button>
    </aside>
  );
}
