import { useEffect, useState } from 'react';
import { CAR_PHYSICS_KEYS, CAR_PHYSICS_SPECS, type CarPhysicsKey } from '@shared/protocol';
import { useSelection } from '../state/selection';
import { useGameStore } from '../state/store';
import { SwipeSlider } from './SwipeSlider';

const FLASH_MS = 900;

function decimalsFor(step: number): number {
  return Math.max(0, -Math.floor(Math.log10(step)));
}

/**
 * Live sliders for every physics param + reset. Values flash when a change arrives over the squad
 * link. Used by the floating panel (P / pinned from the menu) and the ☰ menu's PHYSICS tab.
 */
export function PhysicsSliders() {
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

  const { patchPhysics, resetPhysics } = useGameStore.getState();
  return (
    <>
      {CAR_PHYSICS_KEYS.map((key) => {
        const spec = CAR_PHYSICS_SPECS[key];
        const value = physics[key];
        return (
          <SwipeSlider
            key={key}
            className={flashing.has(key) ? 'is-flash' : undefined}
            title={spec.description}
            label={spec.label}
            valueTestId={`physics-value-${key}`}
            valueText={
              <>
                {value.toFixed(decimalsFor(spec.step))}
                {spec.unit && <small> {spec.unit}</small>}
              </>
            }
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={value}
            onChange={(v) => patchPhysics({ [key]: v }, 'local')}
          />
        );
      })}
      <button type="button" className="hud-btn" onClick={resetPhysics}>
        RESET TO {controls ? 'SQUAD SETUP' : 'DEFAULTS'}
      </button>
    </>
  );
}

/** Floating physics panel (P, or pinned from the ☰ menu's PHYSICS tab). The menu shows its own copy while open. */
export function PhysicsPanel() {
  const open = useGameStore((s) => s.ui.physicsPanelOpen);
  const menuOpen = useSelection((s) => s.menuOpen);
  if (!open || menuOpen) return null;
  const { togglePhysicsPanel } = useGameStore.getState();
  return (
    <aside className="hud-panel hud-physics" data-testid="physics-panel">
      <div className="hud-panel__title">
        PHYSICS
        <button type="button" className="hud-btn hud-btn--ghost" onClick={() => togglePhysicsPanel(false)} aria-label="Close physics panel">
          ✕
        </button>
      </div>
      <PhysicsSliders />
    </aside>
  );
}
