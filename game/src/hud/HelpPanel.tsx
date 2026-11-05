import { useGameStore } from '../state/store';

const KEYS: [string, string][] = [
  ['W / ↑', 'Throttle'],
  ['S / ↓', 'Brake · reverse'],
  ['A D / ← →', 'Steer'],
  ['Space', 'Handbrake'],
  ['W + S', 'Burnout'],
  ['R', 'Respawn at checkpoint'],
  ['T / ⌫', 'Restart run'],
  ['C', 'Camera: chase / orbit / hood'],
  ['P', 'Physics panel'],
  ['H', 'Toggle this help'],
];

export function HelpPanel() {
  const open = useGameStore((s) => s.ui.helpOpen);
  const physicsOpen = useGameStore((s) => s.ui.physicsPanelOpen);
  const camera = useGameStore((s) => s.ui.cameraMode);
  const { toggleHelp, togglePhysicsPanel, cycleCamera } = useGameStore.getState();
  return (
    <div className="hud-corner-br">
      <div className="hud-buttons">
        <button type="button" className="hud-btn" onClick={() => togglePhysicsPanel()} data-testid="physics-toggle">
          PHYSICS [P]
        </button>
        <button type="button" className="hud-btn" onClick={cycleCamera}>
          CAM: {camera.toUpperCase()} [C]
        </button>
        <button type="button" className="hud-btn" onClick={() => toggleHelp()}>
          {open ? 'HIDE' : 'HELP'} [H]
        </button>
      </div>
      {open && !physicsOpen && (
        <div className="hud-panel hud-help">
          <div className="hud-panel__title">CONTROLS</div>
          <dl>
            {KEYS.map(([key, action]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
