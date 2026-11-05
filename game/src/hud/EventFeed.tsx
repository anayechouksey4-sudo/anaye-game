import { useGameStore } from '../state/store';
import { formatClock } from './hudUtils';

const VISIBLE = 7;

export function EventFeed() {
  const events = useGameStore((s) => s.uplink);
  return (
    <div className="hud-panel hud-feed" data-testid="uplink-feed">
      <div className="hud-panel__title">UPLINK</div>
      {events.length === 0 ? (
        <div className="hud-dim">No traffic yet.</div>
      ) : (
        <ol>
          {events.slice(0, VISIBLE).map((e) => (
            <li key={e.id} className={`hud-feed__item hud-feed__item--${e.kind}`}>
              <time>{formatClock(e.at)}</time>
              <span>
                {e.text}
                {e.count > 1 && <em> ×{e.count}</em>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
