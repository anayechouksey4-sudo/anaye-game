import './hud.css';
import './menu.css';
import { lazy, Suspense, useEffect } from 'react';
import { useAutoPause } from './autoPause';
import InputChip from '../input/InputChip';
import { TrophyToast } from '../career';
import { NameTags } from '../rivals/NameTags';
import { useSelection } from '../state/selection';
import { useGameStore } from '../state/store';
import { useWorldHud } from '../state/worldRuntime';
import { AnnounceBanner } from './AnnounceBanner';
import { Banners } from './Banners';
import { Countdown } from './Countdown';
import { EventFeed } from './EventFeed';
import { GameMenu, MenuButton, useMenuBackButton } from './GameMenu';
import { HelpPanel } from './HelpPanel';
import { useHudDebugHandle } from './hudDebug';
import { TOUCH_CONTROLS, useCompactHud } from './hudLayout';
import { LinkPanel } from './LinkPanel';
import { LoadingVeil } from './LoadingVeil';
import { PhysicsPanel } from './PhysicsPanel';
import { Results } from './Results';
import { RunPanel } from './RunPanel';
import { Speedometer } from './Speedometer';
import { StartGate } from './StartGate';
import { TelemetryPanel } from './TelemetryPanel';
import { TopBar } from './TopBar';
import { RotateHint, TouchControls } from './TouchControls';
import { useHudUi, useMinimapShown } from './uiStore';

// Dev-only open-world test stubs (?minimap=mock, ?roamstub=1, ?strictstub=1; hud/minimapMock.ts).
// The condition is a build-time constant, so production builds drop the import and its chunk.
if (import.meta.env.DEV) void import('./minimapMock').then((m) => m.installDevStubs());

// Open-world HUD pieces are their own chunks (the six maps never need them): the minimap mounts while
// a world is active; the island menu blocks (IslandCard.tsx) and the event prompt load on demand.
// All are fetched once the page is idle, so MAPS and the island open without a wait.
const Minimap = lazy(() => import('./Minimap').then((m) => ({ default: m.Minimap })));
const prefetchWorldHud = () => {
  void import('./Minimap');
  void import('./IslandCard');
  void import('./EventPrompt');
};

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
  // Open worlds: the minimap disc (callouts, chips and lights make room for it, minimap.css).
  const minimap = useMinimapShown();
  const worldActive = useWorldHud((s) => s.active);
  useMenuBackButton();
  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(prefetchWorldHud, { timeout: 4000 });
    else {
      const timer = setTimeout(prefetchWorldHud, 2500);
      return () => clearTimeout(timer);
    }
  }, []);
  useAutoPause();
  useHudDebugHandle();
  const className = [
    'hud',
    compact && 'hud--compact',
    TOUCH_CONTROLS && 'hud--touch',
    TOUCH_CONTROLS && !extras && 'hud--bare',
    physicsOpen && 'hud--physics-open',
    menuOpen && 'hud--menu-open',
    minimap && 'hud--minimap',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className} data-testid="hud">
      <div className="hud-corner-tl">
        <LinkPanel compact={compact} />
        {!compact && worldActive && (
          <Suspense fallback={null}>
            <Minimap />
          </Suspense>
        )}
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
      {compact && worldActive && (
        <Suspense fallback={null}>
          <Minimap />
        </Suspense>
      )}
      <NameTags />
      {/* GAMEPAD CONNECTED / TILT … notices under the top bar (input/InputChip; hides with the HUD while the menu is open). */}
      <InputChip />
      <LoadingVeil />
      <Banners />
      <AnnounceBanner />
      {/* Trophy unlock notice (career/TrophyToast): under the top bar, beside the minimap, never over the thumbs. */}
      <TrophyToast />
      <Countdown />
      {TOUCH_CONTROLS && <TouchControls />}
      <Results />
      <GameMenu />
      {TOUCH_CONTROLS && <StartGate />}
    </div>
  );
}
