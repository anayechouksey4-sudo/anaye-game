import './hud.css';
import './menu.css';
import { useAutoPause } from './autoPause';
import { useSelection } from '../state/selection';
import { useGameStore } from '../state/store';
import { Banners } from './Banners';
import { Countdown } from './Countdown';
import { EventFeed } from './EventFeed';
import { GameMenu, MenuButton, useMenuBackButton } from './GameMenu';
import { HelpPanel } from './HelpPanel';
import { useHudDebugHandle } from './hudDebug';
import { TOUCH_CONTROLS, useCompactHud } from './hudLayout';
import { LinkPanel } from './LinkPanel';
import { PhysicsPanel } from './PhysicsPanel';
import { Results } from './Results';
import { RunPanel } from './RunPanel';
import { Speedometer } from './Speedometer';
import { StartGate } from './StartGate';
import { TelemetryPanel } from './TelemetryPanel';
import { TopBar } from './TopBar';
import { RotateHint, TouchControls } from './TouchControls';
import { useHudUi } from './uiStore';

/**
 * HTML overlay on top of the canvas. Only panels with controls take pointer events.
 *
 * Phones (`hud--compact`): speed, gear, timer and checkpoints sit in one slim bar at the top
 * (TopBar), ☰ at the top right opens the menu that holds everything else, the status chips expand
 * on tap. With touch controls (`hud--touch`) everything is laid out around the thumbs; H / the
 * menu's HUD switch hides the chips. Desktop keeps the timer on top and the speedometer at the
 * bottom, with ☰ at the top right.
 */
export function HUD() {
  const compact = useCompactHud();
  const extras = useGameStore((s) => s.ui.helpOpen);
  const physicsOpen = useGameStore((s) => s.ui.physicsPanelOpen);
  const menuOpen = useSelection((s) => s.menuOpen);
  const telemetry = useHudUi((s) => s.telemetry);
  useMenuBackButton();
  useAutoPause();
  useHudDebugHandle();
  const className = [
    'hud',
    compact && 'hud--compact',
    TOUCH_CONTROLS && 'hud--touch',
    TOUCH_CONTROLS && !extras && 'hud--bare',
    physicsOpen && 'hud--physics-open',
    menuOpen && 'hud--menu-open',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className} data-testid="hud">
      <div className="hud-corner-tl">
        <LinkPanel compact={compact} />
        {compact && telemetry && <TelemetryPanel compact />}
        {TOUCH_CONTROLS && <RotateHint />}
      </div>
      {compact ? (
        <div className="hud-top hud-top--bar">
          <TopBar />
        </div>
      ) : (
        <div className="hud-top">
          <RunPanel />
        </div>
      )}
      <div className="hud-corner-tr">
        {!TOUCH_CONTROLS && <MenuButton />}
        <EventFeed />
        <PhysicsPanel />
      </div>
      {!compact && telemetry && (
        <div className="hud-corner-bl">
          <TelemetryPanel />
        </div>
      )}
      {!compact && (
        <div className="hud-bottom">
          <Speedometer />
        </div>
      )}
      {!TOUCH_CONTROLS && <HelpPanel />}
      <Banners />
      <Countdown />
      {TOUCH_CONTROLS && <TouchControls />}
      <Results />
      <GameMenu />
      {TOUCH_CONTROLS && <StartGate />}
    </div>
  );
}
