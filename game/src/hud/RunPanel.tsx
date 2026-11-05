import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { runClock } from '../game/runClock';
import { useGameStore } from '../state/store';
import { formatRaceTime, setText, useRafLoop } from './hudUtils';

export function RunPanel() {
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
  const timerRef = useRef<HTMLSpanElement>(null);

  useRafLoop(() => {
    const { run: r } = useGameStore.getState();
    setText(timerRef.current, formatRaceTime(r.finished ? r.elapsedMs : runClock.elapsedMs));
  });

  return (
    <div className="hud-panel hud-run" data-testid="run-panel">
      <div className="hud-run__track">{trackName}</div>
      <div className={`hud-run__timer${run.finished ? ' is-finished' : run.started ? ' is-running' : ''}`}>
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
      {!run.started && !run.finished && run.pristine && <div className="hud-run__hint">THROTTLE TO START</div>}
    </div>
  );
}
