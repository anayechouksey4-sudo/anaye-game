import { useLayoutEffect, useState } from 'react';
import { getCarEntry } from '../car/catalog';
import { useActiveDriver } from '../state/profile';
import { jumpOutOfReachNote, jumpReach } from '../state/records';
import { useSelection } from '../state/selection';
import { gameState, useGameStore } from '../state/store';
import { getTrackEntry } from '../track/catalog';
import { canFullscreen, toggleFullscreen } from './fullscreen';
import { useHudUi } from './uiStore';

/**
 * Touch devices only: a "tap to race" card over the first frames of every page load.
 *
 * Mobile browsers start audio only from a touch that ENDS (touchend / click), and a GAS thumb held
 * through the start lights doesn't end, so without this card the first run would stay silent until
 * that finger lifted. The tap unlocks the sound (audio/audioSystem.ts listens for it), optionally
 * goes fullscreen (landscape where the browser allows), and starts the run fresh so the lights count
 * down with their beeps. Keyboard players never see it: their first key press unlocks the audio.
 */
function alreadyActivated(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua?.hasBeenActive === true;
}

export function StartGate() {
  const [open, setOpen] = useState(() => !alreadyActivated());
  const car = getCarEntry(useSelection((s) => s.carId));
  const track = getTrackEntry(useSelection((s) => s.trackId));
  const reach = jumpReach(track.id, car.id);
  // The driver at the wheel (DRIVERS tab) and their start-line line.
  const driver = useActiveDriver();
  // Free roam (open worlds): nothing to race, the card just starts the drive.
  const roamLayout = useGameStore((s) => s.trackLayout?.mode === 'roam');
  const roam = roamLayout || track.mode === 'roam';
  // Auto-pause (hud/autoPause.ts) leaves the card alone: no run has really started behind it.
  useLayoutEffect(() => {
    useHudUi.getState().setStartGateOpen(open);
    return () => useHudUi.getState().setStartGateOpen(false);
  }, [open]);
  if (!open) return null;

  const fullscreen = canFullscreen();
  const start = (goFullscreen: boolean) => {
    setOpen(false);
    if (goFullscreen && !document.fullscreenElement) toggleFullscreen();
    // Fresh lights now that the sound is on. The load's own lights have usually gone green behind
    // this card (GO starts the clock), so restart unless the run already got somewhere.
    const { run } = gameState();
    if (run.checkpoint === 0 && !run.finished) gameState().restart();
  };

  return (
    <div className="sg" role="dialog" aria-label="Start" data-testid="start-gate">
      <div className="sg__card">
        <span className="sg__brand">SQUADHQ RACER</span>
        <b className="sg__map" style={{ ['--accent' as string]: track.accent }}>
          {track.name}
        </b>
        <span className="sg__car" style={{ ['--accent' as string]: car.accent }}>
          {car.name}
        </span>
        <span className="sg__driver" data-testid="start-driver">
          {driver.name.toUpperCase()} · <i>{driver.taunt}</i>
        </span>
        {reach && !reach.reachable && (
          <span className="sg__warn" data-testid="start-reach-note">
            BIG JUMP OUT OF REACH · {jumpOutOfReachNote(reach, car.name)}
          </span>
        )}
        <button type="button" className="gm-btn gm-btn--primary sg__go" onClick={() => start(fullscreen)} data-testid="start-race">
          {roam ? (fullscreen ? '▶ DRIVE · FULLSCREEN' : '▶ TAP TO DRIVE') : fullscreen ? '▶ RACE · FULLSCREEN' : '▶ TAP TO RACE'}
        </button>
        {fullscreen && (
          <button type="button" className="gm-btn sg__window" onClick={() => start(false)} data-testid="start-race-window">
            {roam ? 'DRIVE IN THIS WINDOW' : 'RACE IN THIS WINDOW'}
          </button>
        )}
        <span className="sg__hint">Left thumb steers · right thumb GAS, BRAKE, DRIFT · ☰ for cars, maps, physics and sound</span>
      </div>
    </div>
  );
}
