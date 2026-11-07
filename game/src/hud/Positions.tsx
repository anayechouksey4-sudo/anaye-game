/**
 * Live race position from rivals/standings: the `P n/N` chip in the phone top bar (tap → a standings
 * sheet for 3 s, rendered beside the bar because the bar's clip-path would cut it), the four lines
 * with gaps on the desktop run panel. Nothing renders while fewer than two cars are ranked (free
 * roam, rivals OFF with no friends), so the bar keeps its usual width.
 */
import './positions.css';
import { useEffect } from 'react';
import { create } from 'zustand';
import { PLAYER_ID, useStandings, type StandingRow } from '../rivals/standings';

const SHEET_MS = 3000;
const MAX_ROWS = 8;

// The sheet's open flag is shared between the chip (inside the bar) and the sheet (outside it).
const useSheet = create<{ open: boolean; until: number; set: (open: boolean) => void }>()((set) => ({
  open: false,
  until: 0,
  set: (open) => set({ open, until: open ? Date.now() + SHEET_MS : 0 }),
}));

function gapText(row: StandingRow, index: number): string {
  if (index === 0) return row.finished ? 'WIN' : 'LEAD';
  if (row.gapS === null) return '—';
  return `+${row.gapS.toFixed(1)} s`;
}

function Rows({ order }: { order: StandingRow[] }) {
  return (
    <>
      {order.slice(0, MAX_ROWS).map((row, i) => (
        <div
          key={row.id}
          className={`hud-pos-row${row.id === PLAYER_ID ? ' is-you' : ''}${row.finished ? ' is-done' : ''}`}
          style={row.id === PLAYER_ID ? undefined : ({ ['--row' as string]: row.color } as React.CSSProperties)}
          data-testid={`standing-${i + 1}`}
        >
          <i>P{i + 1}</i>
          <b>{row.id === PLAYER_ID ? 'YOU' : row.name.toUpperCase()}</b>
          <span>{gapText(row, i)}</span>
        </div>
      ))}
    </>
  );
}

/** Phone top bar: `P2/4`; tap for the standings sheet (StandingsSheet, mounted beside the bar). */
export function PositionChip() {
  const { playerPosition, total } = useStandings();
  const setSheet = useSheet((s) => s.set);
  const open = useSheet((s) => s.open);
  useEffect(() => {
    if (total < 2 && open) setSheet(false);
  }, [total, open, setSheet]);
  if (total < 2 || playerPosition === 0) return null;
  return (
    <button type="button" className={`hud-topbar__pos${playerPosition === 1 ? ' is-p1' : ''}`} onClick={() => setSheet(!open)} aria-label={`Position ${playerPosition} of ${total}`}>
      <label>POS</label>
      <b data-testid="hud-position">
        P{playerPosition}
        <small>/{total}</small>
      </b>
    </button>
  );
}

/** The 3-second standings sheet under the phone top bar (TopBar renders it next to the bar). */
export function StandingsSheet() {
  const { order, total } = useStandings();
  const open = useSheet((s) => s.open);
  const until = useSheet((s) => s.until);
  const setSheet = useSheet((s) => s.set);
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setSheet(false), Math.max(0, until - Date.now()));
    return () => window.clearTimeout(timer);
  }, [open, until, setSheet]);
  if (!open || total < 2) return null;
  return (
    <div className="hud-panel hud-pos-sheet" data-testid="standings-sheet" onClick={() => setSheet(false)}>
      <Rows order={order} />
    </div>
  );
}

/** Desktop run panel: every car with its gap to the one ahead. */
export function PositionsPanel() {
  const { order, total, playerPosition } = useStandings();
  if (total < 2 || playerPosition === 0) return null;
  return (
    <div className="hud-run__pos" data-testid="standings-panel">
      <Rows order={order} />
    </div>
  );
}
