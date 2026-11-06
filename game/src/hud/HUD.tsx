import './hud.css';
import { useGameStore } from '../state/store';
import { Banners } from './Banners';
import { EventFeed } from './EventFeed';
import { HelpPanel } from './HelpPanel';
import { TOUCH_CONTROLS, useCompactHud } from './hudLayout';
import { LinkPanel } from './LinkPanel';
import { PhysicsPanel } from './PhysicsPanel';
import { RunPanel } from './RunPanel';
import { Speedometer } from './Speedometer';
import { TelemetryPanel } from './TelemetryPanel';
import { RotateHint, TouchControls } from './TouchControls';

/**
 * HTML overlay on top of the canvas. Only panels with controls take pointer events. On phones
 * (`hud--compact`) the big panels become chips that expand on tap; with touch controls
 * (`hud--touch`) everything is laid out around the thumbs, and H / the HUD button hides the chips.
 */
export function HUD() {
  const compact = useCompactHud();
  const extras = useGameStore((s) => s.ui.helpOpen);
  const physicsOpen = useGameStore((s) => s.ui.physicsPanelOpen);
  const className = [
    'hud',
    compact && 'hud--compact',
    TOUCH_CONTROLS && 'hud--touch',
    TOUCH_CONTROLS && !extras && 'hud--bare',
    physicsOpen && 'hud--physics-open',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className} data-testid="hud">
      <div className="hud-corner-tl">
        <LinkPanel compact={compact} />
        {compact && <TelemetryPanel compact />}
        {TOUCH_CONTROLS && <RotateHint />}
      </div>
      <div className="hud-top">
        <RunPanel compact={compact} />
      </div>
      <div className="hud-corner-tr">
        <EventFeed />
        <PhysicsPanel />
      </div>
      {!compact && (
        <div className="hud-corner-bl">
          <TelemetryPanel />
        </div>
      )}
      <div className="hud-bottom">
        <Speedometer />
      </div>
      {!TOUCH_CONTROLS && <HelpPanel />}
      <Banners />
      {TOUCH_CONTROLS && <TouchControls />}
    </div>
  );
}
