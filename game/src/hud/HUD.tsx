import './hud.css';
import { Banners } from './Banners';
import { EventFeed } from './EventFeed';
import { HelpPanel } from './HelpPanel';
import { LinkPanel } from './LinkPanel';
import { PhysicsPanel } from './PhysicsPanel';
import { RunPanel } from './RunPanel';
import { Speedometer } from './Speedometer';
import { TelemetryPanel } from './TelemetryPanel';

/** HTML overlay on top of the canvas. Only panels with controls take pointer events. */
export function HUD() {
  return (
    <div className="hud" data-testid="hud">
      <div className="hud-corner-tl">
        <LinkPanel />
      </div>
      <div className="hud-top">
        <RunPanel />
      </div>
      <div className="hud-corner-tr">
        <EventFeed />
        <PhysicsPanel />
      </div>
      <div className="hud-corner-bl">
        <TelemetryPanel />
      </div>
      <div className="hud-bottom">
        <Speedometer />
      </div>
      <HelpPanel />
      <Banners />
    </div>
  );
}
