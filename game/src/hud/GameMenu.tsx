/**
 * The ☰ menu: pause screen + garage + maps + physics + settings + squad link, thumb-sized and
 * scrollable in both orientations. Open = `useSelection().menuOpen` (App pauses <Physics> from it,
 * so the run clock, hazards and pendulums freeze). Opened by ☰, Esc / M, or GARAGE on the results
 * screen; closed by RESUME, ✕/☰, Esc / M, the Android back button (useMenuBackButton) or picking a
 * car or map (which starts a new run with the start lights).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { CAR_CATALOG, getCarEntry, resolveCarId, type CarCatalogEntry } from '../car/catalog';
import { MEDALS, jumpOutOfReachNote, jumpReach, loadBestTime, medalFor, medalsFor, type JumpReach } from '../state/records';
import { selectionState, useSelection } from '../state/selection';
import { CAMERA_MODES, gameState, useGameStore, type CameraMode } from '../state/store';
import { TRACK_CATALOG, getTrackEntry, type TrackMedals } from '../track/catalog';
import { resolveTrackId } from '../track/registry';
import { EventFeed } from './EventFeed';
import { canFullscreen, toggleFullscreen, useFullscreen } from './fullscreen';
import { TOUCH_CONTROLS } from './hudLayout';
import { formatRaceTime } from './hudUtils';
import { LinkStatusBadge, SquadDetails } from './LinkPanel';
import { PhysicsSliders } from './PhysicsPanel';
import { MedalBadge } from './Results';
import { SwipeSlider } from './SwipeSlider';
import { JumpVerdict } from './TelemetryPanel';
import { closeMenu, MENU_TABS, useHudUi, type MenuTab } from './uiStore';

const CAMERA_LABEL: Record<CameraMode, string> = { chase: 'CHASE', orbit: 'ORBIT', hood: 'HOOD' };
const CAR_STATS: readonly [keyof CarCatalogEntry['stats'], string][] = [
  ['topSpeed', 'TOP SPEED'],
  ['acceleration', 'ACCEL'],
  ['grip', 'GRIP'],
  ['weight', 'WEIGHT'],
];

/** The map and car actually in play (ids resolved like the track registry / car catalog do). */
function useCurrent() {
  const trackId = resolveTrackId(useSelection((s) => s.trackId));
  const carId = resolveCarId(useSelection((s) => s.carId));
  return { trackId, carId, track: getTrackEntry(trackId), car: getCarEntry(carId) };
}

function pickCar(id: string): void {
  // A different car restarts the run at the spawn (store.carChanged); the lights count on resume.
  selectionState().setCar(id);
  closeMenu();
}

function pickMap(id: string): void {
  selectionState().setTrack(id);
  closeMenu();
}

function Toggle({ label, sub, on, onChange, testId, disabled }: { label: string; sub?: ReactNode; on: boolean; onChange: (on: boolean) => void; testId: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`gm-toggle${on ? ' is-on' : ''}`}
      onClick={() => onChange(!on)}
      data-testid={testId}
      disabled={disabled}
    >
      <span className="gm-toggle__text">
        <b>{label}</b>
        {sub && <small>{sub}</small>}
      </span>
      <span className="gm-toggle__switch" aria-hidden="true">
        <i />
      </span>
      <span className="gm-toggle__state">{on ? 'ON' : 'OFF'}</span>
    </button>
  );
}

function CameraPicker() {
  const mode = useGameStore((s) => s.ui.cameraMode);
  return (
    <div className="gm-seg" role="radiogroup" aria-label="Camera" data-testid="menu-camera">
      {CAMERA_MODES.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          className={mode === m ? 'is-on' : undefined}
          onClick={() => gameState().setCameraMode(m)}
          data-testid={`menu-camera-${m}`}
        >
          {CAMERA_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="gm-section">
      <h3 className="gm-section__title">
        {title}
        {aside}
      </h3>
      {children}
    </section>
  );
}

/** Gold / silver / bronze times (for one car on one map, records.ts `medalsFor`); a won medal glows. */
function MedalTargets({ medals, bestMs, testId }: { medals: TrackMedals | null; bestMs: number | null; testId?: string }) {
  if (!medals) return null;
  return (
    <span className="gm-targets" data-testid={testId}>
      {MEDALS.map((m) => (
        <span key={m} className={`gm-target gm-target--${m}${bestMs !== null && bestMs <= medals[m] ? ' is-won' : ''}`}>
          <i aria-hidden="true" />
          {formatRaceTime(medals[m])}
        </span>
      ))}
    </span>
  );
}

/** "JUMP OUT OF REACH" badge for a car that can't clear a map's big jump with any setting. */
function ReachBadge({ reach, testId }: { reach: JumpReach | null; testId: string }) {
  if (!reach || reach.reachable) return null;
  return (
    <span className="gm-badge gm-badge--reach" data-testid={testId} title={`Needs ${Math.round(reach.requiredKmh)} km/h, tops out at ${Math.round(reach.maxTopKmh ?? 0)} km/h`}>
      JUMP OUT OF REACH
    </span>
  );
}

const DRIVE_HELP_TOUCH: [string, string][] = [
  ['◀ ▶ pad', 'Steer: thumb on an arrow is full lock, nearer the middle steers gently'],
  ['GAS', 'Throttle (waits for GO at the start)'],
  ['BRAKE', 'Brake, reverses once stopped'],
  ['DRIFT', 'Handbrake: slide the thumb from GAS for a drift turn'],
  ['⟲', 'Respawn at the last checkpoint'],
  ['☰', 'This menu (pauses the game)'],
];
const DRIVE_HELP_KEYS: [string, string][] = [
  ['W / ↑', 'Throttle (waits for GO)'],
  ['S / ↓', 'Brake · reverse'],
  ['A D / ← →', 'Steer'],
  ['Space', 'Handbrake'],
  ['R · T', 'Respawn · restart'],
  ['C · P · H', 'Camera · physics · help'],
  ['Esc / M', 'This menu (pause)'],
];

function RaceTab({ goTo }: { goTo: (tab: MenuTab) => void }) {
  const { trackId, carId, track, car } = useCurrent();
  const run = useGameStore((s) => s.run);
  const best = loadBestTime(trackId, carId);
  const medals = medalsFor(trackId, carId);
  const reach = jumpReach(trackId, carId);
  const medal = medalFor(best, medals);
  return (
    <>
      <div className="gm-now" style={{ ['--accent' as string]: track.accent }}>
        <button type="button" className="gm-now__item" onClick={() => goTo('maps')} data-testid="menu-now-map">
          <span className="gm-k">MAP</span>
          <b>{track.name}</b>
          <span className="gm-link">CHANGE ▸</span>
        </button>
        <button type="button" className="gm-now__item" style={{ ['--accent' as string]: car.accent }} onClick={() => goTo('garage')} data-testid="menu-now-car">
          <span className="gm-k">CAR</span>
          <b>{car.name}</b>
          <span className="gm-link">CHANGE ▸</span>
        </button>
      </div>
      <dl className="gm-runstats">
        <div>
          <dt>TIME</dt>
          <dd data-testid="menu-run-time">{formatRaceTime(run.elapsedMs)}</dd>
        </div>
        <div>
          <dt>CHECKPOINT</dt>
          <dd>
            {run.checkpoint}/{run.totalCheckpoints}
          </dd>
        </div>
        <div>
          <dt>FALLS</dt>
          <dd>{run.falls}</dd>
        </div>
        <div>
          <dt>BEST</dt>
          <dd>
            {formatRaceTime(best)} <MedalBadge medal={medal} small />
          </dd>
        </div>
      </dl>
      {reach && !reach.reachable ? (
        <div className="gm-reach" data-testid="menu-reach-note">
          <b>BIG JUMP OUT OF REACH</b>
          <span>
            {jumpOutOfReachNote(reach, car.name)}, so it can't finish here: no medals. Pick a faster car to finish.
          </span>
        </div>
      ) : (
        medals && (
          <div className="gm-medalrow">
            <label>MEDALS · {car.name.toUpperCase()}</label>
            <MedalTargets medals={medals} bestMs={best} testId="menu-medal-targets" />
          </div>
        )
      )}
      <Section title="CAMERA">
        <CameraPicker />
      </Section>
      <Section title="HOW TO DRIVE">
        <dl className="gm-help">
          {(TOUCH_CONTROLS ? DRIVE_HELP_TOUCH : DRIVE_HELP_KEYS).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {track.tip && <p className="gm-tip">TIP · {track.tip}</p>}
      </Section>
    </>
  );
}

function GarageTab() {
  const { trackId, carId, track } = useCurrent();
  return (
    <>
      <p className="gm-lead">Pick a car: it starts a fresh run at the start line. Best times and medals (each car has its own) are for {track.name}.</p>
      <div className="gm-cards">
        {CAR_CATALOG.map((c) => {
          const selected = c.id === carId;
          const best = loadBestTime(trackId, c.id);
          const medals = medalsFor(trackId, c.id);
          const reach = jumpReach(trackId, c.id);
          return (
            <button
              key={c.id}
              type="button"
              className={`gm-card gm-car${selected ? ' is-selected' : ''}`}
              style={{ ['--accent' as string]: c.accent }}
              onClick={() => pickCar(c.id)}
              aria-pressed={selected}
              data-testid={`garage-${c.id}`}
            >
              <span className="gm-card__head">
                <b>{c.name}</b>
                {selected && <span className="gm-tag">DRIVING</span>}
              </span>
              {reach && !reach.reachable && (
                <span className="gm-badges">
                  <ReachBadge reach={reach} testId={`garage-reach-${c.id}`} />
                  <span className="gm-reach-sub">needs {Math.round(reach.requiredKmh)} km/h · max {Math.round(reach.maxTopKmh ?? 0)}</span>
                </span>
              )}
              <span className="gm-card__text">{c.tagline}</span>
              <span className="gm-stats">
                {CAR_STATS.map(([key, label]) => (
                  <span key={key} className="gm-stat">
                    <span className="gm-k">{label}</span>
                    <i style={{ ['--fill' as string]: `${Math.round(c.stats[key] * 100)}%` }} />
                  </span>
                ))}
              </span>
              <span className="gm-card__foot">
                <span className="gm-k">BEST</span>
                <b data-testid={`garage-best-${c.id}`}>{best === null ? 'NO TIME YET' : formatRaceTime(best)}</b>
                <MedalBadge medal={medalFor(best, medals)} small />
                <MedalTargets medals={medals} bestMs={best} testId={`garage-medals-${c.id}`} />
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function MapsTab() {
  const { trackId, carId, car } = useCurrent();
  return (
    <>
      <p className="gm-lead">Pick a map: it loads with a fresh run. Best times and medals are for the {car.name}.</p>
      <div className="gm-cards">
        {TRACK_CATALOG.map((t) => {
          const selected = t.id === trackId;
          const best = loadBestTime(t.id, carId);
          const medals = medalsFor(t.id, carId);
          const reach = jumpReach(t.id, carId);
          return (
            <button
              key={t.id}
              type="button"
              className={`gm-card gm-map${selected ? ' is-selected' : ''}`}
              style={{ ['--accent' as string]: t.accent }}
              onClick={() => pickMap(t.id)}
              aria-pressed={selected}
              data-testid={`map-${t.id}`}
            >
              <span className="gm-card__head">
                <b>{t.name}</b>
                {selected && <span className="gm-tag">RACING</span>}
              </span>
              <span className="gm-badges">
                <span className="gm-pips" aria-label={`Difficulty ${t.difficulty} of 5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <i key={n} className={n <= t.difficulty ? 'on' : undefined} />
                  ))}
                </span>
                {t.hasBigJump && <span className="gm-badge gm-badge--jump">BIG JUMP{t.bigJumpKmh ? ` ${t.bigJumpKmh} KM/H` : ''}</span>}
                {t.surfaceGrip !== undefined && t.surfaceGrip < 1 && <span className="gm-badge gm-badge--ice">ICE · {Math.round(t.surfaceGrip * 100)}% GRIP</span>}
                <ReachBadge reach={reach} testId={`map-reach-${t.id}`} />
              </span>
              {reach && !reach.reachable && (
                <span className="gm-reach-sub">
                  {jumpOutOfReachNote(reach, car.name)}: no finish, no medals.
                </span>
              )}
              <span className="gm-card__text">{t.description}</span>
              {t.tip && <span className="gm-card__tip">SETUP · {t.tip}</span>}
              <span className="gm-card__foot">
                <span className="gm-k">BEST</span>
                <b data-testid={`map-best-${t.id}`}>{best === null ? 'NO TIME YET' : formatRaceTime(best)}</b>
                <MedalBadge medal={medalFor(best, medals)} small />
                <MedalTargets medals={medals} bestMs={best} testId={`map-medals-${t.id}`} />
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function PhysicsTab() {
  const pinned = useGameStore((s) => s.ui.physicsPanelOpen);
  return (
    <>
      <p className="gm-lead">Live tuning for this car (SquadHQ sliders still win when they change). The game is paused while you tune.</p>
      <Toggle
        label="SHOW WHILE DRIVING"
        sub={TOUCH_CONTROLS ? 'Floating panel between the thumbs' : 'Floating panel, also on P'}
        on={pinned}
        onChange={(on) => gameState().togglePhysicsPanel(on)}
        testId="menu-physics-pin"
      />
      <div className="gm-physics" data-testid="menu-physics">
        <PhysicsSliders />
      </div>
    </>
  );
}

function SettingsTab() {
  const settings = useSelection((s) => s.settings);
  const hudOn = useGameStore((s) => s.ui.helpOpen);
  const telemetry = useHudUi((s) => s.telemetry);
  const fullscreen = useFullscreen();
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  const { setSettings } = selectionState();
  return (
    <>
      <Section title="DISPLAY">
        <Toggle
          label="HUD"
          sub={TOUCH_CONTROLS ? 'Squad link and telemetry chips (speed and timer always show)' : 'Controls help panel (H)'}
          on={hudOn}
          onChange={(on) => gameState().toggleHelp(on)}
          testId="menu-hud"
        />
        <Toggle label="TELEMETRY" sub="Aero, slip and axle loads" on={telemetry} onChange={(on) => useHudUi.getState().setTelemetry(on)} testId="menu-telemetry" />
        {canFullscreen() && <Toggle label="FULLSCREEN" sub="Hides the browser bars; locks landscape where allowed" on={fullscreen} onChange={() => toggleFullscreen()} testId="menu-fullscreen" />}
      </Section>
      <Section title="CAMERA">
        <CameraPicker />
      </Section>
      <Section title="SOUND & FEEL">
        <Toggle label="SOUND" sub="Engine, tyres and effects" on={settings.sound} onChange={(sound) => setSettings({ sound })} testId="menu-sound" />
        <div className={`gm-volume${settings.sound ? '' : ' is-off'}`}>
          <SwipeSlider
            label="VOLUME"
            valueText={`${Math.round(settings.volume * 100)}%`}
            valueTestId="menu-volume-value"
            testId="menu-volume"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(volume) => setSettings({ volume })}
          />
        </div>
        <Toggle
          label="VIBRATION"
          sub={canVibrate ? 'Buzz on checkpoints, hits and falls' : 'Not supported by this browser'}
          on={settings.haptics}
          onChange={(haptics) => {
            setSettings({ haptics });
            if (haptics && canVibrate) navigator.vibrate(40);
          }}
          testId="menu-haptics"
        />
      </Section>
    </>
  );
}

function SquadTab() {
  return (
    <>
      <div className="gm-squad-head">
        <LinkStatusBadge testId="menu-link-status" />
      </div>
      <div className="gm-squad hud-link" data-testid="menu-squad">
        <SquadDetails />
        <JumpVerdict />
      </div>
      <p className="gm-lead">Open SquadHQ (the dashboard) on another phone or PC on the same Wi-Fi to tune Front Wing Aero, Engine Tier and Chassis Balance live.</p>
      <div className="gm-feed">
        <EventFeed />
      </div>
    </>
  );
}

const TAB_BODY: Record<MenuTab, (props: { goTo: (tab: MenuTab) => void }) => ReactNode> = {
  race: RaceTab,
  garage: GarageTab,
  maps: MapsTab,
  physics: PhysicsTab,
  settings: SettingsTab,
  squad: SquadTab,
};

export function GameMenu() {
  const open = useSelection((s) => s.menuOpen);
  if (!open) return null;
  return <MenuPanel />;
}

function MenuPanel() {
  const tab = useHudUi((s) => s.menuTab);
  const setTab = useHudUi((s) => s.setMenuTab);
  const { track, car } = useCurrent();
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const openedAt = useRef(performance.now());
  const Body = TAB_BODY[tab];

  // Keyboard focus moves into the dialog (Tab reaches the buttons), but not onto a button: a Space still
  // held for the handbrake would "click" it on release and close the menu straight away.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  const respawn = () => {
    gameState().respawn('manual');
    closeMenu();
  };
  const restart = () => {
    gameState().restart();
    closeMenu();
  };

  return (
    <div className="gm" ref={rootRef} tabIndex={-1} data-menu data-testid="game-menu" role="dialog" aria-modal="true" aria-label="Menu, game paused">
      <div className="gm__panel">
        <header className="gm__head">
          <span className="gm__logo" aria-hidden="true">
            ☰
          </span>
          <div className="gm__title">
            <b>PAUSED</b>
            <small>
              {track.name} · {car.name}
            </small>
          </div>
          <button
            type="button"
            className="gm__close"
            // ✕ sits where ☰ was: ignore a click that is really the tail of the tap that opened the menu.
            onClick={() => performance.now() - openedAt.current > 350 && closeMenu()}
            aria-label="Close menu and resume"
            data-testid="menu-close"
          >
            ✕
          </button>
        </header>
        <nav className="gm__tabs" role="tablist" aria-label="Menu sections">
          {MENU_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'is-on' : undefined}
              onClick={() => setTab(t.id)}
              data-testid={`menu-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="gm__body" ref={bodyRef} role="tabpanel" data-testid={`menu-body-${tab}`}>
          <Body goTo={setTab} />
        </div>
        <footer className="gm__foot">
          <button type="button" className="gm-btn" onClick={respawn} data-testid="menu-respawn">
            ⟲ RESPAWN
          </button>
          <button type="button" className="gm-btn" onClick={restart} data-testid="menu-restart">
            ⏮ RESTART
          </button>
          <button type="button" className="gm-btn gm-btn--primary gm-btn--resume" onClick={closeMenu} data-testid="menu-resume">
            ▶ RESUME
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Android back button / browser back closes the menu instead of leaving the game: opening pushes a
 * history entry, popstate closes; closing any other way pops that entry again. Mount once in an
 * always-mounted component (StrictMode's mount double-run then happens while the menu is closed).
 *
 * A menu opened while the page is hidden (auto-pause on an app switch, hud/autoPause.ts) gets its
 * entry when the page is visible again: a page that is being unloaded or put in the back/forward
 * cache never has history pushed under it, and coming back still leaves exactly one entry.
 */
export function useMenuBackButton(): void {
  const open = useSelection((s) => s.menuOpen);
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const marker = `gm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let pushed = false;
    let popped = false;
    const onPop = () => {
      popped = true;
      selectionState().setMenuOpen(false);
    };
    const push = () => {
      if (pushed || document.visibilityState === 'hidden') return;
      pushed = true;
      try {
        window.history.pushState({ ...(window.history.state as object | null), gameMenu: marker }, '');
      } catch {
        return; // Sandboxed frame without history access: ✕ / RESUME still close it.
      }
      window.addEventListener('popstate', onPop);
    };
    push();
    document.addEventListener('visibilitychange', push);
    window.addEventListener('pageshow', push);
    return () => {
      document.removeEventListener('visibilitychange', push);
      window.removeEventListener('pageshow', push);
      window.removeEventListener('popstate', onPop);
      const state = window.history.state as { gameMenu?: string } | null;
      if (pushed && !popped && state?.gameMenu === marker) window.history.back();
    };
  }, [open]);
}

/** Desktop and small desktop windows (touch layouts get theirs from TouchControls). */
export function MenuButton() {
  const open = useSelection((s) => s.menuOpen);
  return (
    <button
      type="button"
      className="hud-menu-btn"
      onClick={() => selectionState().toggleMenu()}
      aria-label="Menu (Esc / M)"
      aria-expanded={open}
      data-testid="menu-button"
      title="Menu (Esc / M)"
    >
      <span aria-hidden="true">☰</span>
      <small>MENU</small>
    </button>
  );
}
