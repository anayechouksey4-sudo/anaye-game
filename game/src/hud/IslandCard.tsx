import type { CSSProperties, ReactNode } from 'react';
import { MEDALS, loadBestTime, medalFor, medalsFor } from '../state/records';
import { useWorldHud, type MapMarker, type MinimapImage } from '../state/worldRuntime';
import type { TrackCatalogEntry, TrackMedals } from '../track/catalog';
import { formatRaceTime } from './hudUtils';
import { MedalBadge, exitToFreeRoam } from './Results';
import { closeMenu } from './uiStore';

/** Thumbnail edge in device-independent px of the cached picture (CSS shows it at ~96 px). */
const THUMB_PX = 192;

interface WorldThumb {
  url: string | null;
  /** Event start flags in % of the picture. */
  flags: { x: number; y: number; accent: string; trackId: string }[];
}

/** Last minimap picture + event flags per world, kept after leaving it so MAPS still shows the island. */
const thumbs = new Map<string, WorldThumb>();

function thumbFor(world: string): WorldThumb {
  let t = thumbs.get(world);
  if (!t) {
    t = { url: null, flags: [] };
    thumbs.set(world, t);
  }
  return t;
}

/** Pictures already cached (the minimap image object is stable per world data). */
const thumbed = new WeakSet<MinimapImage>();

/**
 * Minimap.tsx: the base picture was painted; cache a small copy for the MAPS card. Built on the CPU
 * from the minimap pixels, off the critical path: reading back a GPU canvas (toDataURL, or toBlob on
 * an accelerated canvas) makes the main thread wait for the GPU, which is busy with the island's
 * uploads right then (1.3–3.4 s on a software GPU). Here the downsample runs in an idle callback, the
 * small canvas is CPU-backed (willReadFrequently) and toBlob encodes it asynchronously.
 */
export function rememberWorldPicture(world: string, image: MinimapImage): void {
  if (thumbed.has(image)) return;
  thumbed.add(image);
  const run = () => {
    try {
      const small = document.createElement('canvas');
      small.width = THUMB_PX;
      small.height = THUMB_PX;
      const ctx = small.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      const out = ctx.createImageData(THUMB_PX, THUMB_PX);
      const src = image.data;
      const sx = image.width / THUMB_PX;
      const sy = image.height / THUMB_PX;
      for (let y = 0; y < THUMB_PX; y++) {
        const v = Math.min(image.height - 1, Math.floor((y + 0.5) * sy));
        for (let x = 0; x < THUMB_PX; x++) {
          const u = Math.min(image.width - 1, Math.floor((x + 0.5) * sx));
          const i = (v * image.width + u) * 4;
          const o = (y * THUMB_PX + x) * 4;
          out.data[o] = src[i]!;
          out.data[o + 1] = src[i + 1]!;
          out.data[o + 2] = src[i + 2]!;
          out.data[o + 3] = src[i + 3]!;
        }
      }
      ctx.putImageData(out, 0, 0);
      small.toBlob((blob) => {
        if (!blob) return;
        const t = thumbFor(world);
        if (t.url) URL.revokeObjectURL(t.url);
        t.url = URL.createObjectURL(blob);
      }, 'image/png');
    } catch {
      // Canvas unavailable: the card keeps its placeholder.
    }
  };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 4000 });
  else window.setTimeout(run, 1000);
}

/** Minimap.tsx: markers changed; free-roam event markers become the card's flags. */
export function rememberWorldEvents(world: string, image: MinimapImage, markers: readonly MapMarker[]): void {
  const events = markers.filter((m) => m.kind === 'event' && m.trackId);
  if (events.length === 0) return;
  const w = image.width * image.metresPerPixel;
  const h = image.height * image.metresPerPixel;
  thumbFor(world).flags = events.map((m) => ({
    x: ((m.x - image.originX) / w) * 100,
    y: ((m.z - image.originZ) / h) * 100,
    accent: m.accent ?? '#ffffff',
    trackId: m.trackId!,
  }));
}

/**
 * Placeholder before the first visit: the island's three-lobed outline (r = 700 − 210·cos 3θ in its
 * 2048 m frame, north up) filled with its region colours by compass sector, The Crown in the middle.
 */
const PLACEHOLDER: CSSProperties = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 72; i++) {
    const th = (i / 72) * Math.PI * 2;
    const r = 700 - 210 * Math.cos(3 * th);
    const x = 50 + ((r * Math.cos(th)) / 2048) * 100;
    const y = 50 - ((r * Math.sin(th)) / 2048) * 100;
    pts.push(`${x.toFixed(1)}% ${y.toFixed(1)}%`);
  }
  return {
    clipPath: `polygon(${pts.join(',')})`,
    background:
      'radial-gradient(circle at 51% 50%, #b9c0c8 0 7%, #7f8a86 8% 17%, transparent 18%),' +
      'conic-gradient(from -2deg at 50% 50%, #c8553d 0 62deg, #d9c58a 62deg 120deg, #6fae5a 120deg 184deg, #a7c27a 184deg 242deg, #5865ff 242deg 302deg, #e3cf8f 302deg 360deg)',
  };
})();

function IslandThumb({ world }: { world: string }) {
  // Re-render when a picture arrives while the menu is open (rare); the cache does the rest.
  useWorldHud((s) => (s.worldId === world ? s.minimap : null));
  useWorldHud((s) => (s.worldId === world ? s.markers : null));
  const t = thumbs.get(world);
  return (
    <span className="gm-island__thumb" aria-hidden="true" data-testid="island-thumb" data-cached={t?.url ? 'yes' : 'no'}>
      {t?.url ? <img src={t.url} alt="" /> : <i className="gm-island__placeholder" style={PLACEHOLDER} />}
      {t?.flags.map((f) => <b key={f.trackId} className="gm-island__flag" style={{ left: `${f.x}%`, top: `${f.y}%`, ['--accent' as string]: f.accent }} />)}
    </span>
  );
}

function Targets({ medals, bestMs }: { medals: TrackMedals | null; bestMs: number | null }) {
  if (!medals) return null;
  return (
    <span className="gm-targets">
      {MEDALS.map((m) => (
        <span key={m} className={`gm-target gm-target--${m}${bestMs !== null && bestMs <= medals[m] ? ' is-won' : ''}`}>
          <i aria-hidden="true" />
          {formatRaceTime(medals[m])}
        </span>
      ))}
    </span>
  );
}

/**
 * MAPS tab: every catalog entry of one open world as ONE card (PLAN §5.1): TESSERA ISLE · OPEN
 * WORLD, a north-up thumbnail with event flags, ▶ FREE ROAM, and a 56 px row per race (name,
 * terrain, length, difficulty, this car's best + medal, this car's medal times). A tap picks the
 * entry like any map card: the world stays loaded, the car goes to the start, the lights run.
 */
export function IslandCard({ entries, trackId, carId, onPick }: { entries: readonly TrackCatalogEntry[]; trackId: string; carId: string; onPick: (id: string) => void }) {
  const roam = entries.find((e) => e.mode === 'roam') ?? entries[0]!;
  const world = roam.world ?? roam.id;
  const races = entries.filter((e) => e !== roam);
  const here = entries.some((e) => e.id === trackId);
  return (
    <div className={`gm-card gm-island${here ? ' is-selected' : ''}`} style={{ ['--accent' as string]: roam.accent }} data-testid={`island-${world}`}>
      <span className="gm-card__head">
        <b>{roam.name.toUpperCase()} · OPEN WORLD</b>
        {here && <span className="gm-tag">{trackId === roam.id ? 'DRIVING' : 'RACING'}</span>}
      </span>
      <span className="gm-island__top">
        <IslandThumb world={world} />
        <span className="gm-card__text">{roam.description}</span>
      </span>
      <button type="button" className="gm-btn gm-btn--primary gm-island__roam" onClick={() => onPick(roam.id)} aria-pressed={trackId === roam.id} data-testid={`map-${roam.id}`}>
        ▶ FREE ROAM
      </button>
      <span className="gm-island__rows">
        {races.map((t) => {
          const best = loadBestTime(t.id, carId);
          const medals = medalsFor(t.id, carId);
          return (
            <button
              key={t.id}
              type="button"
              className={`gm-island__row${t.id === trackId ? ' is-selected' : ''}`}
              style={{ ['--accent' as string]: t.accent }}
              onClick={() => onPick(t.id)}
              aria-pressed={t.id === trackId}
              data-testid={`map-${t.id}`}
            >
              <span className="gm-island__line">
                <b>{t.name}</b>
                {t.terrain && <span className="gm-badge gm-island__chip">{t.terrain}</span>}
                {t.lengthM !== undefined && <span className="gm-island__len">{(t.lengthM / 1000).toFixed(1)} KM</span>}
                <span className="gm-pips" aria-label={`Difficulty ${t.difficulty} of 5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <i key={n} className={n <= t.difficulty ? 'on' : undefined} />
                  ))}
                </span>
              </span>
              <span className="gm-island__line gm-island__line--sub">
                <span className="gm-k">BEST</span>
                <b className="gm-island__best" data-testid={`map-best-${t.id}`}>
                  {best === null ? 'NO TIME YET' : formatRaceTime(best)}
                </b>
                <MedalBadge medal={medalFor(best, medals)} small />
                <Targets medals={medals} bestMs={best} />
              </span>
            </button>
          );
        })}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gm-section">
      <h3 className="gm-section__title">{title}</h3>
      {children}
    </section>
  );
}

/**
 * RACE tab on an open world (PLAN §5.2). In a race: the event, EXIT TO FREE ROAM (where the car is)
 * and CHANGE EVENT. In free roam: the region, TRAVEL (one button per spot) and EVENTS (start buttons).
 */
export function IslandBlock({ track, entries, onMaps, onPick }: { track: TrackCatalogEntry; entries: readonly TrackCatalogEntry[]; onMaps: () => void; onPick: (id: string) => void }) {
  const region = useWorldHud((s) => s.regionLabel);
  const spots = useWorldHud((s) => s.travelSpots);
  const actions = useWorldHud((s) => s.actions);
  const world = track.world ?? track.id;
  if (track.mode !== 'roam') {
    return (
      <div className="gm-isle" data-testid="menu-island" style={{ ['--accent' as string]: track.accent }}>
        <div className="gm-isle__now">
          <span className="gm-k">ISLAND EVENT</span>
          <b>{track.name}</b>
          {track.lengthM !== undefined && (
            <small>
              {(track.lengthM / 1000).toFixed(1)} KM{track.terrain ? ` · ${track.terrain}` : ''}
            </small>
          )}
        </div>
        <div className="gm-isle__actions">
          <button
            type="button"
            className="gm-btn gm-btn--primary"
            onClick={() => {
              exitToFreeRoam(world);
              closeMenu();
            }}
            data-testid="menu-exit-roam"
          >
            EXIT TO FREE ROAM
          </button>
          <button type="button" className="gm-btn" onClick={onMaps} data-testid="menu-change-event">
            CHANGE EVENT ▸
          </button>
        </div>
      </div>
    );
  }
  const races = entries.filter((t) => t.mode !== 'roam');
  return (
    <div className="gm-isle" data-testid="menu-island">
      <div className="gm-isle__now">
        <span className="gm-k">FREE ROAM · REGION</span>
        <b data-testid="menu-region">{region || '—'}</b>
      </div>
      {spots.length > 0 && (
        <Section title="TRAVEL">
          <div className="gm-isle__grid" data-testid="menu-travel">
            {spots.map((spot) => (
              <button
                key={spot.id}
                type="button"
                className="gm-btn gm-isle__spot"
                disabled={!actions}
                onClick={() => {
                  actions?.travel(spot.id);
                  closeMenu();
                }}
                data-testid={`menu-travel-${spot.id}`}
              >
                {spot.label}
              </button>
            ))}
          </div>
        </Section>
      )}
      <Section title="EVENTS">
        <div className="gm-isle__grid" data-testid="menu-events">
          {races.map((t) => (
            <button
              key={t.id}
              type="button"
              className="gm-btn gm-isle__event"
              style={{ ['--accent' as string]: t.accent }}
              onClick={() => onPick(t.id)}
              data-testid={`menu-event-${t.id}`}
            >
              <span>▶ {t.name}</span>
              {t.lengthM !== undefined && <small>{(t.lengthM / 1000).toFixed(1)} KM</small>}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}
