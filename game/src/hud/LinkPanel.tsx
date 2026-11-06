import { useRef, useState } from 'react';
import { describeChassisBalance, SQUAD_CONTROL_SPECS } from '@shared/protocol';
import { useGameStore, type LinkStatus } from '../state/store';
import { setText, useRafLoop } from './hudUtils';

const STATUS_LABEL: Record<LinkStatus, string> = {
  disabled: 'OFFLINE MODE',
  connecting: 'CONNECTING',
  connected: 'LIVE',
  disconnected: 'LINK DOWN',
};

function ageText(lastUpdateAt: number | null): string {
  if (lastUpdateAt === null) return 'never';
  const s = (Date.now() - lastUpdateAt) / 1000;
  if (s < 1) return 'just now';
  if (s < 60) return `${s.toFixed(0)} s ago`;
  return `${Math.floor(s / 60)} min ago`;
}

/** Compact (phone) HUD: a one-line status chip that expands into the full panel on tap. */
export function LinkPanel({ compact = false }: { compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const status = useGameStore((s) => s.linkStatus);
  const url = useGameStore((s) => s.serverUrl);
  const dashboards = useGameStore((s) => s.dashboards);
  const rtt = useGameStore((s) => s.rttMs);
  const controls = useGameStore((s) => s.controls);
  const ageRef = useRef<HTMLElement>(null);

  useRafLoop(() => setText(ageRef.current, ageText(useGameStore.getState().lastUpdateAt)), 250);

  const statusBadge = (
    <span className={`hud-status hud-status--${status}`} data-testid="link-status">
      <i />
      {STATUS_LABEL[status]}
    </span>
  );
  if (compact && !expanded) {
    return (
      <button type="button" className="hud-panel hud-chip hud-link" data-testid="link-panel" onClick={() => setExpanded(true)} aria-expanded={false}>
        {statusBadge}
        {status === 'connected' && <span className="hud-dim">{dashboards}</span>}
        <span className="hud-chip__more" aria-hidden="true">
          ▾
        </span>
      </button>
    );
  }

  const balance = controls ? describeChassisBalance(controls.chassisBalance) : null;
  return (
    <div className={`hud-panel hud-link${compact ? ' is-expanded' : ''}`} data-testid="link-panel">
      <div className="hud-panel__title">
        SQUAD LINK
        {statusBadge}
        {compact && (
          <button type="button" className="hud-btn hud-btn--ghost" onClick={() => setExpanded(false)} aria-label="Collapse squad link">
            ▴
          </button>
        )}
      </div>
      <dl className="hud-kv">
        <dt>RELAY</dt>
        <dd className="hud-link__url">{url || '—'}</dd>
        <dt>SQUAD</dt>
        <dd>
          {dashboards} dashboard{dashboards === 1 ? '' : 's'}
          {rtt !== null && <span className="hud-dim"> · {rtt} ms</span>}
        </dd>
        <dt>UPDATE</dt>
        <dd>
          <b ref={ageRef}>never</b>
        </dd>
      </dl>
      <div className="hud-squad">
        {controls ? (
          <>
            <div className="hud-squad__item">
              <label>{SQUAD_CONTROL_SPECS.frontWingAero.label}</label>
              <div className="hud-bar hud-bar--cyan" style={{ ['--fill' as string]: `${controls.frontWingAero}%` }} />
              <b>{controls.frontWingAero}%</b>
            </div>
            <div className="hud-squad__item">
              <label>{SQUAD_CONTROL_SPECS.engineTier.label}</label>
              <div className="hud-pips">
                {[1, 2, 3, 4, 5].map((t) => (
                  <i key={t} className={t <= controls.engineTier ? 'on' : undefined} />
                ))}
              </div>
              <b>T{controls.engineTier}</b>
            </div>
            <div className="hud-squad__item">
              <label>{SQUAD_CONTROL_SPECS.chassisBalance.label}</label>
              <div className="hud-balance">
                <i style={{ left: `${50 + controls.chassisBalance}%` }} />
              </div>
              <b>
                {balance?.front}/{balance?.rear}
              </b>
            </div>
          </>
        ) : (
          <div className="hud-dim">Waiting for SquadHQ… using local defaults.</div>
        )}
      </div>
    </div>
  );
}
