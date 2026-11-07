import { useRef, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getCountdownSnapshot, subscribeCountdown } from '../game/countdown';
import { runClock } from '../game/runClock';
import { useGameStore } from '../state/store';
import { useWorldHud } from '../state/worldRuntime';
import { formatRaceTime, setText, useRafLoop } from './hudUtils';
import { PositionsPanel } from './Positions';

/** Desktop run panel (phones show the timer and checkpoints in TopBar). */
export function RunPanel() {
  const roam = useGameStore((s) => s.trackLayout?.mode === 'roam');
  return roam ? <RoamPanel /> : <RacePanel />;
}

/** Free roam on an open world: no timer, checkpoints or best time; the region under the car instead (as the phone TopBar). */
function RoamPanel() {
  const trackName = useGameStore((s) => s.trackLayout?.name ?? '—');
  const region = useWorldHud((s) => s.regionLabel);
  return (
    <div className="hud-panel hud-run is-roam" data-testid="run-panel">
      <div className="hud-run__track">{trackName}</div>
      <div className="hud-run__timer hud-run__roam" data-testid="hud-roam">
        FREE ROAM
      </div>
      <div className="hud-run__region" data-testid="hud-region">
        {region || '\u00a0'}
      </div>
      <div className="hud-run__hint is-calm">PARK ON A GLOWING PAD TO START A RACE</div>
    </div>
  );
}

function RacePanel() {
  // Field-level selection: the run object is refreshed at ~10 Hz for the timer mirror.
  const run = useGameStore(
    useShallow((s) => ({
      checkpoint: s.run.checkpoint,
      totalCheckpoints: s.run.totalCheckpoints,
      falls: s.run.falls,
      bestMs: s.run.bestMs,
      speedTrapKmh: s.run.speedTrapKmh,
      started: s.run.started,
      finished: s.run.finished,
      pristine: s.run.elapsedMs === 0,
    })),
  );
  const trackName = useGameStore((s) => s.trackLayout?.name ?? '—');
  const countingDown = useSyncExternalStore(subscribeCountdown, () => getCountdownSnapshot().active);
  const timerRef = useRef<HTMLSpanElement>(null);

  useRafLoop(() => {
    const { run: r } = useGameStore.getState();
    setText(timerRef.current, formatRaceTime(r.finished ? r.elapsedMs : runClock.elapsedMs));
  });

  const timerClass = `hud-run__timer${run.finished ? ' is-finished' : run.started ? ' is-running' : ''}`;
  const hint = !run.started && !run.finished && run.pristine && (
    <div className="hud-run__hint">{countingDown ? 'GET READY' : 'THROTTLE TO START'}</div>
  );

  return (
    <div className="hud-panel hud-run" data-testid="run-panel">
      <div className="hud-run__track">{trackName}</div>
      <div className={timerClass}>
        <span ref={timerRef}>0:00.000</span>
      </div>
      <div className="hud-run__stats">
        <div>
          <label>CP</label>
          <b data-testid="hud-checkpoint">
            {run.checkpoint}/{run.totalCheckpoints}
          </b>
        </div>
        <div>
          <label>FALLS</label>
          <b className={run.falls > 0 ? 'is-bad' : undefined}>{run.falls}</b>
        </div>
        <div>
          <label>BEST</label>
          <b>{formatRaceTime(run.bestMs)}</b>
        </div>
        <div>
          <label>TRAP</label>
          <b>{run.speedTrapKmh === null ? '—' : `${run.speedTrapKmh.toFixed(0)}`}</b>
        </div>
      </div>
      <PositionsPanel />
      {hint}
    </div>
  );
}
