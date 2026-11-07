/**
 * CAREER tab (☰ menu): the header strip (trophies, medals, podiums, km), the trophy grid (44 px
 * cells; a tap shows the hint), the MAPS × CARS medal matrix (scrolls sideways; a tap names the
 * combination) and the STATS list. RESET CAREER needs two taps. Reads career/store.ts only.
 */
import './career.css';
import { useEffect, useState } from 'react';
import { CAR_CATALOG } from '../car/catalog';
import { kmDriven, medalCounts, useCareer, type Career, type CareerMedal } from '../career/store';
import { TROPHIES, TROPHY_COUNT, trophyById } from '../career/trophies';
import { TrophyGlyph } from '../career/TrophyToast';
import { TRACK_CATALOG } from '../track/catalog';

/** Maps with medals, catalog order (classic first, then the island races). */
const MEDAL_MAPS = TRACK_CATALOG.filter((t) => t.medalsMs !== undefined);

const MEDAL_SHORT: Record<CareerMedal, string> = { gold: 'G', silver: 'S', bronze: 'B' };
/** RESET CAREER stays armed for a second tap this long. */
const RESET_ARM_MS = 5000;

export function formatRunTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const t = Math.floor((total % 1000) / 100);
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}.${t}` : `${s}.${t} s`;
}

export function formatKm(m: number): string {
  const km = m / 1000;
  return km >= 100 ? `${Math.round(km)} km` : km >= 10 ? `${km.toFixed(1)} km` : `${km.toFixed(2)} km`;
}

export function formatPlayed(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min ${String(total % 60).padStart(2, '0')} s`;
  return `${total} s`;
}

/** Short map label for the matrix rows: the last word of island races, the first of classic maps. */
export function mapTag(id: string, name: string): string {
  const words = name.toUpperCase().split(/\s+/);
  const word = id.startsWith('tessera-') ? words[words.length - 1] : (words[1] ?? words[0]);
  return (word ?? id.toUpperCase()).slice(0, 7);
}

/** Three-letter car tag for the matrix columns. */
export const carTag = (id: string): string => id.slice(0, 3).toUpperCase();

function unlockedOn(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Strip({ career }: { career: Career }) {
  const medals = medalCounts(career);
  const unlocked = Object.keys(career.trophies).filter((id) => trophyById(id)).length;
  return (
    <div className="cr-strip" data-testid="career-strip">
      <div className="cr-tile">
        <span className="gm-k">TROPHIES</span>
        <b data-testid="career-trophy-count">
          {unlocked}/{TROPHY_COUNT}
        </b>
      </div>
      <div className="cr-tile">
        <span className="gm-k">MEDALS</span>
        <b className="cr-tile__medals" data-testid="career-medals">
          <i className="cr-dot cr-dot--gold" />
          {medals.gold}
          <i className="cr-dot cr-dot--silver" />
          {medals.silver}
          <i className="cr-dot cr-dot--bronze" />
          {medals.bronze}
        </b>
      </div>
      <div className="cr-tile">
        <span className="gm-k">PODIUMS</span>
        <b data-testid="career-podiums">{career.totals.podiums}</b>
      </div>
      <div className="cr-tile">
        <span className="gm-k">DRIVEN</span>
        <b data-testid="career-km">{formatKm(career.totals.distanceM)}</b>
      </div>
    </div>
  );
}

function TrophyGrid({ career }: { career: Career }) {
  const [picked, setPicked] = useState<string | null>(null);
  const trophy = picked ? trophyById(picked) : undefined;
  const at = trophy ? career.trophies[trophy.id] : undefined;
  return (
    <section className="gm-section cr-section" data-testid="career-trophies">
      <h3 className="gm-section__title">
        TROPHIES <span className="gm-link">TAP ONE</span>
      </h3>
      <div className="cr-grid">
        {TROPHIES.map((t) => {
          const won = t.id in career.trophies;
          return (
            <button
              key={t.id}
              type="button"
              className={`cr-trophy${won ? ' is-won' : ' is-locked'}${picked === t.id ? ' is-picked' : ''}`}
              onClick={() => setPicked(picked === t.id ? null : t.id)}
              aria-pressed={picked === t.id}
              aria-label={`${t.name}${won ? ', unlocked' : ', locked'}`}
              data-testid={`trophy-${t.id}`}
              data-won={won ? '1' : '0'}
            >
              <TrophyGlyph d={t.glyph} className="cr-trophy__glyph" />
              <span className="cr-trophy__name">{t.name}</span>
            </button>
          );
        })}
      </div>
      {trophy && (
        <p className="cr-detail" data-testid="trophy-detail">
          <b>{trophy.name}</b> · {trophy.hint} {at !== undefined ? <span className="cr-detail__won">UNLOCKED {unlockedOn(at)}</span> : <span className="cr-detail__locked">LOCKED</span>}
        </p>
      )}
    </section>
  );
}

function MedalMatrix({ career }: { career: Career }) {
  const [picked, setPicked] = useState<string | null>(null);
  const pickedRecord = picked ? career.records[picked] : undefined;
  const [pTrack, pCar] = picked ? picked.split('|') : [undefined, undefined];
  const trackName = pTrack ? (TRACK_CATALOG.find((t) => t.id === pTrack)?.name ?? pTrack) : '';
  const carName = pCar ? (CAR_CATALOG.find((c) => c.id === pCar)?.name ?? pCar) : '';
  return (
    <section className="gm-section cr-section" data-testid="career-matrix">
      <h3 className="gm-section__title">
        MEDALS · MAPS × CARS <span className="gm-link">SCROLLS ▸</span>
      </h3>
      <div className="cr-scroll">
        <table className="cr-matrix">
          <thead>
            <tr>
              <th scope="col" className="cr-matrix__corner" />
              {CAR_CATALOG.map((c) => (
                <th key={c.id} scope="col" title={c.name}>
                  {carTag(c.id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MEDAL_MAPS.map((t) => (
              <tr key={t.id}>
                <th scope="row" title={t.name}>
                  {mapTag(t.id, t.name)}
                </th>
                {CAR_CATALOG.map((c) => {
                  const key = `${t.id}|${c.id}`;
                  const r = career.records[key];
                  const medal = r?.medal ?? null;
                  return (
                    <td key={c.id}>
                      <button
                        type="button"
                        className={`cr-cell${medal ? ` cr-cell--${medal}` : r ? ' cr-cell--run' : ''}${picked === key ? ' is-picked' : ''}`}
                        onClick={() => setPicked(picked === key ? null : key)}
                        aria-label={`${t.name} with ${c.name}: ${medal ?? (r ? 'finished, no medal' : 'not raced')}`}
                        data-testid={`cell-${t.id}-${c.id}`}
                        data-medal={medal ?? ''}
                      >
                        {medal ? MEDAL_SHORT[medal] : r ? '·' : ''}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {picked && (
        <p className="cr-detail" data-testid="matrix-detail">
          <b>{trackName}</b> · {carName} ·{' '}
          {pickedRecord ? (
            <>
              BEST {pickedRecord.bestMs !== null ? formatRunTime(pickedRecord.bestMs) : '—'} · {pickedRecord.medal ? pickedRecord.medal.toUpperCase() : 'NO MEDAL'} · {pickedRecord.runs} RUN{pickedRecord.runs === 1 ? '' : 'S'}
              {pickedRecord.bestPosition !== null ? ` · BEST P${pickedRecord.bestPosition}` : ''}
            </>
          ) : (
            'NOT RACED YET'
          )}
        </p>
      )}
    </section>
  );
}

function Stats({ career }: { career: Career }) {
  const t = career.totals;
  const topMap = t.topSpeedMap ? (TRACK_CATALOG.find((m) => m.id === t.topSpeedMap)?.name ?? t.topSpeedMap) : null;
  const topCar = t.topSpeedCar ? (CAR_CATALOG.find((c) => c.id === t.topSpeedCar)?.name ?? t.topSpeedCar) : null;
  const rows: [string, string][] = [
    ['RACES FINISHED', String(t.racesFinished)],
    ['WINS VS RIVALS', String(t.wins)],
    ['PODIUMS', String(t.podiums)],
    ['FRIENDS RACES', `${t.friendsWon} won / ${t.friendsPlayed} played`],
    ['DISTANCE', `${kmDriven(career).toFixed(2)} km`],
    ['TOP SPEED', t.topSpeedKmh > 0 ? `${Math.round(t.topSpeedKmh)} km/h${topMap ? ` · ${topMap}` : ''}${topCar ? ` · ${topCar}` : ''}` : '—'],
    ['LONGEST AIR', t.longestAirS > 0 ? `${t.longestAirS.toFixed(2)} s · ${t.longestLeapM.toFixed(1)} m` : '—'],
    ['TIME PLAYED', formatPlayed(t.timePlayedS)],
    ['FALLS', String(t.falls)],
    ['REGIONS VISITED', String(career.regions.length)],
    ['CARS RACED', String(career.carsFinished.length)],
  ];
  return (
    <section className="gm-section cr-section" data-testid="career-stats">
      <h3 className="gm-section__title">STATS</h3>
      <dl className="cr-stats">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ResetCareer() {
  const reset = useCareer((s) => s.reset);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), RESET_ARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <div className="cr-reset">
      <button
        type="button"
        className={`gm-btn cr-reset__btn${armed ? ' is-armed' : ''}`}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          reset();
          setArmed(false);
        }}
        data-testid="career-reset"
        data-armed={armed ? '1' : '0'}
      >
        {armed ? 'TAP AGAIN TO ERASE EVERYTHING' : 'RESET CAREER'}
      </button>
      {armed && (
        <button type="button" className="gm-btn cr-reset__cancel" onClick={() => setArmed(false)} data-testid="career-reset-cancel">
          KEEP
        </button>
      )}
    </div>
  );
}

export function CareerTab() {
  const career = useCareer((s) => s.career);
  return (
    <div className="cr" data-testid="career-tab">
      <Strip career={career} />
      <TrophyGrid career={career} />
      <MedalMatrix career={career} />
      <Stats career={career} />
      <ResetCareer />
    </div>
  );
}

export default CareerTab;
