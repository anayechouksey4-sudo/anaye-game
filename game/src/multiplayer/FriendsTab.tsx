/**
 * FRIENDS tab of the ☰ menu (mounted by GameMenu): YOUR NAME, host a room of a chosen size, join by
 * code, see who is in (RECONNECTING… while a friend's link is down), READY, START (host), REMOVE /
 * MAKE HOST (host), LEAVE (the host confirms who gets the room), the share link and the results
 * table. Offline / unlinked it explains how to reach a relay. Rooms are humans only: no AI rivals, no
 * ghost. Every control is ≥ 44 px (menu.css buttons, 46 px fields); fits 360×640 and 740×280.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ROOM_CODE_LENGTH, ROOM_MAX_NAME, ROOM_SIZES, type RoomPlayer, type RoomRace } from '@shared/protocol';
import { getCarEntry, resolveCarId } from '../car/catalog';
import { portraitDataUrl } from '../drivers/portrait';
import { LinkStatusBadge } from '../hud/LinkPanel';
import { formatRaceTime } from '../hud/hudUtils';
import { useHudUi } from '../hud/uiStore';
import { useGameStore, type LinkStatus } from '../state/store';
import { getActiveLink } from '../net/squadLink';
import { getTrackEntry } from '../track/catalog';
import { cleanName, needsNamePrompt, roomName, useFriendsProfile } from './friendsProfile';
import { decodePlayer } from './identity';
import { relayNow, roomActions } from './roomClient';
import { isFramed, PUBLIC_GAME_URL, promptInstall, usePwa } from '../pwa/register';
import { useProfile } from '../state/profile';
import { isHost, nextHost, positionOf, sortedResults, useRoom, type RoomState } from './roomStore';

/** The relay address typed in CONNECT, remembered so the installed app reconnects to it on the next start
 *  (the hosted copy's start-up script reads it; see scripts/build-pages.mjs). */
export const SAVED_RELAY_KEY = 'gamerfleet.relay.v1';
/** The saved relay address, or '' when none is saved or the player chose offline ('off'). */
export function savedRelay(): string {
  try {
    const v = localStorage.getItem(SAVED_RELAY_KEY) ?? '';
    return v === 'off' ? '' : v;
  } catch {
    return '';
  }
}
/** `null` records the player's choice to play offline ('off'): the hosted copy then skips its default relay. */
function rememberRelay(value: string | null): void {
  try {
    localStorage.setItem(SAVED_RELAY_KEY, value || 'off');
  } catch {
    /* private mode: the address still works for this visit */
  }
}
/** A relay named in the address (`?ws=…`, e.g. from a friend's copied room link) is remembered like one typed
 *  in CONNECT, so the installed app comes back online on its own. `off` and empty values are ignored. */
export function rememberRelayFromUrl(): void {
  try {
    const ws = new URLSearchParams(window.location.search).get('ws');
    if (ws && ws !== 'off' && ws !== '0' && ws !== 'false') rememberRelay(ws.trim());
  } catch {
    /* no URL access */
  }
}
function reloadWithRelay(value: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('ws', value);
  window.location.assign(url.toString());
}
import './friends.css';

/**
 * performance.now() when this page started trying to reach the relay (since load, or since the link
 * was last connected); null while connected or offline. Tracked from page load (this module loads with
 * the game), so the waking counter is right whenever FRIENDS is opened. The 8 s connect timeout flips
 * the status to 'disconnected' between attempts; both count as still trying.
 */
let wakeStartedAt: number | null = null;
/** An attempt failed since wakeStartedAt (a LAN relay then reads NO RELAY REACHED until it answers, without flicker). */
let wakeFailed = false;
function trackWake(status: LinkStatus): void {
  if (status === 'connected' || status === 'disabled') {
    wakeStartedAt = null;
    wakeFailed = false;
    return;
  }
  if (wakeStartedAt === null) wakeStartedAt = performance.now();
  if (status === 'disconnected') wakeFailed = true;
}
trackWake(useGameStore.getState().linkStatus);
useGameStore.subscribe((s, prev) => {
  if (s.linkStatus !== prev.linkStatus) trackWake(s.linkStatus);
});
/** After this long trying, say the server is waking (a free hosted relay sleeps when idle). */
const WAKE_NOTICE_MS = 3000;
/** After this long, offer RETRY next to the address. */
const RETRY_AFTER_MS = 45_000;

const PHASE_LABEL: Record<RoomRace['phase'], string> = { lobby: 'LOBBY', countdown: 'LIGHTS', racing: 'RACE ON', results: 'RESULTS' };
/** One line wherever rooms are explained (the owner's report: friends races are humans only). */
const HUMANS_ONLY = 'AI rivals and your ghost are off in rooms';
const sizeLabel = (n: number) => (n === 2 ? 'YOU + 1 FRIEND' : `YOU + ${n - 1} FRIENDS`);
/** "2/2" when the relay keeps seats, else just the head count (a relay that predates sizes). */
const seatCount = (count: number, size: number | null) => (size === null ? `${count}` : `${count}/${size}`);

export default function FriendsTab() {
  const linkStatus = useGameStore((s) => s.linkStatus);
  const serverUrl = useGameStore((s) => s.serverUrl);
  const room = useRoom();
  return (
    <div className="fr" data-testid="friends-tab">
      <div className="fr__head">
        <LinkStatusBadge testId="friends-link" />
        <span className="fr__url" data-testid="friends-url">
          {serverUrl || 'no relay (?ws=off)'}
        </span>
        {savedRelay() && (
          <button
            type="button"
            className="gm-btn fr__btn fr__btn--fit"
            onClick={() => {
              rememberRelay(null);
              reloadWithRelay('off');
            }}
            data-testid="friends-forget-relay-top"
          >
            FORGET RELAY
          </button>
        )}
      </div>
      {room.error && (
        <p className="fr__error" role="alert" data-testid="friends-error">
          {room.error.message}
        </p>
      )}
      {linkStatus !== 'connected' && <RejoinNote code={room.rejoining} />}
      {linkStatus !== 'connected' ? <ConnectHelp linkStatus={linkStatus} serverUrl={serverUrl} /> : room.status === 'in-room' ? <InRoom room={room} /> : <Entry room={room} />}
      <GetTheGame />
    </div>
  );
}

/** Friends who arrived by a room link can install the game from here and pass the game link on. */
function GetTheGame() {
  const pwa = usePwa();
  const [copied, setCopied] = useState(false);
  const gameLink = (() => {
    try {
      const u = new URL(window.location.href);
      return `${u.origin}${u.pathname}`;
    } catch {
      return '';
    }
  })();
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(gameLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Game link', gameLink);
    }
  };
  let install: ReactNode;
  if (isFramed()) {
    install = (
      <a className="gm-btn gm-btn--primary fr__btn fr__btn--fit" href={PUBLIC_GAME_URL} target="_blank" rel="noopener noreferrer" data-testid="friends-open-page">
        OPEN THE GAME PAGE
      </a>
    );
  } else if (pwa.standalone || pwa.installed) {
    install = <span className="fr__got" data-testid="friends-installed">INSTALLED ON THIS DEVICE</span>;
  } else if (pwa.canInstall) {
    install = (
      <button type="button" className="gm-btn gm-btn--primary fr__btn fr__btn--fit" onClick={() => void promptInstall()} data-testid="friends-install">
        INSTALL THE GAME
      </button>
    );
  } else if (pwa.ios) {
    install = <span className="fr__got">iPhone / iPad: Share → Add to Home Screen</span>;
  } else {
    install = <span className="fr__got">Install: browser menu → Install app</span>;
  }
  return (
    <div className="fr__get" data-testid="friends-get">
      <b className="fr__get-title">GET THE GAME</b>
      <div className="fr__row fr__row--wrap">
        {install}
        {gameLink && (
          <button type="button" className="gm-btn fr__btn fr__btn--fit" onClick={() => void copyLink()} data-testid="friends-copy-game">
            {copied ? 'LINK COPIED' : 'COPY GAME LINK'}
          </button>
        )}
      </div>
      <p className="fr__hint">Installs free from the browser, plays offline, and opens straight into your relay once you have connected once.</p>
    </div>
  );
}

/** Getting back into a room after a link drop or a reload (AI rivals stay off meanwhile); LEAVE ROOM gives up. */
function RejoinNote({ code }: { code: string | null }) {
  if (!code) return null;
  return (
    <div className="fr__note fr__note--row" data-testid="friends-rejoining">
      <span>THE LINK DROPPED · GETTING BACK INTO ROOM {code}… YOUR SEAT IS KEPT FOR 2 MIN</span>
      <button type="button" className="gm-btn fr__btn fr__btn--fit" onClick={() => roomActions.leave()} data-testid="friends-rejoin-cancel">
        LEAVE ROOM
      </button>
    </div>
  );
}

/** No socket: how to get one (same Wi-Fi via dev:all, or a relay address). */
function ConnectHelp({ linkStatus, serverUrl }: { linkStatus: LinkStatus; serverUrl: string }) {
  const [address, setAddress] = useState(() => savedRelay());
  const remembered = savedRelay();
  const trying = linkStatus === 'connecting' || linkStatus === 'disconnected';
  // Re-render once a second while trying (the elapsed counter).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!trying) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [trying]);
  const elapsed = trying && wakeStartedAt !== null ? performance.now() - wakeStartedAt : 0;
  const seconds = Math.floor(elapsed / 1000);
  // The hosted relay (wss://) sleeps when idle and takes up to ~30 s to wake; a LAN relay answers at once.
  const hosted = serverUrl.startsWith('wss://');
  const retry = () => {
    const link = getActiveLink();
    if (link) {
      // stop() + start() reconnects on the next tick and keeps the room client's listeners.
      link.stop();
      link.start();
    }
    wakeStartedAt = performance.now();
    wakeFailed = false;
    setTick((n) => n + 1);
  };
  const noRelay = (
    <>
      <b>NO RELAY REACHED.</b> It retries on its own; check the address below.
    </>
  );
  const connect = (e: FormEvent) => {
    e.preventDefault();
    const value = address.trim();
    if (!value) return;
    rememberRelay(value);
    reloadWithRelay(value);
  };
  const lead =
    linkStatus === 'disabled' ? (
      <>
        <b>OFFLINE MODE.</b> Playing with friends needs the relay that comes with the game.
      </>
    ) : elapsed < WAKE_NOTICE_MS ? (
      <>
        <b>CONNECTING TO THE RELAY…</b> Rooms open as soon as it answers.
      </>
    ) : hosted ? null : wakeFailed ? (
      <>
        {noRelay} · {seconds} s
      </>
    ) : (
      <>
        <b>CONNECTING TO THE RELAY…</b> Rooms open as soon as it answers · {seconds} s
      </>
    );
  return (
    <>
      {lead && <p className="fr__lead">{lead}</p>}
      {trying && hosted && elapsed >= WAKE_NOTICE_MS && (
        <p className="fr__lead" aria-live="polite" data-testid="friends-waking">
          <b>WAKING THE ONLINE SERVER…</b> (up to 30 s the first time) · <span aria-hidden="true">{seconds} s</span>
        </p>
      )}
      {trying && elapsed >= RETRY_AFTER_MS && (
        <div className="fr__note fr__note--row" data-testid="friends-retry-row">
          {hosted ? <span>{noRelay}</span> : <span>Still trying · {seconds} s</span>}
          <button type="button" className="gm-btn fr__btn fr__btn--fit" onClick={retry} data-testid="friends-retry">
            RETRY
          </button>
        </div>
      )}
      <ol className="fr__steps">
        <li>
          On one computer or phone run <code>npm run dev:all</code> (it prints <code>http://&lt;ip&gt;:5173</code>).
        </li>
        <li>Everyone on the same Wi-Fi or hotspot opens that link.</li>
        <li>
          Over the internet: host the relay (server/README.md) and open the game with <code>?ws=wss://your-relay</code>.
        </li>
      </ol>
      <form className="fr__row" onSubmit={connect}>
        <input
          className="fr__input fr__input--url"
          placeholder="RELAY ADDRESS · host:8787 or wss://…"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Relay address"
          data-testid="friends-relay-input"
        />
        <button type="submit" className="gm-btn fr__btn fr__btn--fit" disabled={!address.trim()} data-testid="friends-connect">
          CONNECT
        </button>
      </form>
      <p className="fr__hint">
        {remembered
          ? 'This address is remembered on this device; FORGET RELAY above switches this device to offline play.'
          : 'The address is remembered on this device: the installed app reconnects to it on its own.'}
      </p>
    </>
  );
}

/** The one-time card on a device that still carries the owner's default driver name: what should friends call you? */
function NamePrompt({ current }: { current?: string }) {
  const setName = useFriendsProfile((s) => s.setName);
  const markAsked = useFriendsProfile((s) => s.markAsked);
  const [value, setValue] = useState('');
  const ok = (e: FormEvent) => {
    e.preventDefault();
    if (cleanName(value)) setName(value);
    markAsked();
  };
  return (
    <form className="fr__ask" onSubmit={ok} data-testid="friends-name-prompt">
      <b className="fr__ask-title">WHAT SHOULD FRIENDS CALL YOU?</b>
      <p className="fr__hint">
        {current ? (
          <>
            Friends here see you as <b>{current}</b>. Shown next to your car in rooms; change it any time.
          </>
        ) : (
          'Shown next to your car in rooms. You can change it here any time.'
        )}
      </p>
      <div className="fr__row">
        <input
          className="fr__input"
          placeholder="YOUR NAME"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={ROOM_MAX_NAME}
          autoComplete="nickname"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Your name"
          data-testid="friends-name-prompt-input"
        />
        <button type="submit" className="gm-btn gm-btn--primary fr__btn fr__btn--fit" disabled={!cleanName(value)} data-testid="friends-name-prompt-ok">
          OK
        </button>
      </div>
      <button type="button" className="gm-btn fr__btn fr__btn--skip" onClick={markAsked} data-testid="friends-name-prompt-skip">
        SKIP
      </button>
    </form>
  );
}

/** YOUR NAME: prefilled from the selected driver, saved on this device as you type. */
function NameField() {
  const saved = useFriendsProfile((s) => s.name);
  const setName = useFriendsProfile((s) => s.setName);
  const driverName = useProfile((s) => roomName(s));
  const [value, setValue] = useState(() => saved || driverName);
  return (
    <label className="fr__name" data-testid="friends-name">
      <small>YOUR NAME</small>
      <input
        className="fr__input"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setName(e.target.value);
        }}
        onBlur={() => setValue(cleanName(value) || driverName)}
        maxLength={ROOM_MAX_NAME}
        autoComplete="nickname"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Your name"
        data-testid="friends-name-input"
      />
    </label>
  );
}

/** ROOM SIZE: 2 · 3 · 4 · 6 · 8 (sizes below `min` are greyed out). */
function SizePicker({ value, onPick, min = 2, testId, disabled = false }: { value: number; onPick: (n: number) => void; min?: number; testId: string; disabled?: boolean }) {
  return (
    <div className="fr__sizes" role="radiogroup" aria-label="Room size" data-testid={testId}>
      {ROOM_SIZES.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={n === value}
          className={`gm-btn fr__size${n === value ? ' is-on' : ''}`}
          disabled={disabled || n < min}
          onClick={() => onPick(n)}
          data-testid={`${testId}-${n}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** Connected, not in a room: host or join. */
function Entry({ room }: { room: RoomState }) {
  // A failed join (ROOM FULL…) keeps its code in the field, so trying again is one tap (not after REMOVE).
  const refill = (r: RoomState) => (r.error && r.error.code !== 'removed' && r.error.code !== 'not_found' ? r.lastCode : null);
  const [code, setCode] = useState(room.pendingCode ?? refill(room) ?? '');
  const refillCode = refill(room);
  useEffect(() => {
    if (refillCode) setCode((c) => c || refillCode);
  }, [refillCode, room.error]);
  const size = useFriendsProfile((s) => s.size);
  const setSize = useFriendsProfile((s) => s.setSize);
  const asked = useFriendsProfile((s) => s.asked);
  const named = useFriendsProfile((s) => s.name);
  const profile = useProfile();
  const joining = room.status === 'joining';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    roomActions.join(code);
  };
  // `asked` / `named` are read so the card goes away the moment it is answered.
  if (!asked && !named && needsNamePrompt(profile)) return <NamePrompt />;
  return (
    <>
      <RejoinNote code={room.rejoining} />
      <NameField />
      <p className="fr__lead">
        Race the same map at the same time. Everyone drives their own car; friends' cars pass through yours (no collisions). The dashboard still tunes every car in the room.
      </p>
      <p className="fr__humans" data-testid="friends-humans-only">{HUMANS_ONLY}</p>
      <div className="fr__sizebox">
        <small>
          ROOM SIZE · <b data-testid="friends-size-label">{sizeLabel(size)}</b>
        </small>
        <SizePicker value={size} onPick={setSize} testId="friends-size" disabled={joining} />
      </div>
      <button type="button" className="gm-btn gm-btn--primary fr__btn fr__btn--host" onClick={() => roomActions.host(size)} disabled={joining} data-testid="friends-host">
        {joining ? 'ONE MOMENT…' : 'HOST A ROOM'}
        <small>{size} PLAYERS · YOU PICK THE MAP · FRIENDS JOIN BY CODE</small>
      </button>
      <form className="fr__row" onSubmit={submit}>
        <input
          className="fr__input fr__input--code"
          placeholder="ROOM CODE"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, ROOM_CODE_LENGTH))}
          maxLength={ROOM_CODE_LENGTH}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-label="Room code"
          data-testid="friends-code-input"
        />
        <button type="submit" className="gm-btn fr__btn fr__btn--fit" disabled={joining || code.length !== ROOM_CODE_LENGTH} data-testid="friends-join">
          JOIN
        </button>
      </form>
      {room.left === 'link' && !room.rejoining && <p className="fr__note">The relay link dropped; the room is re-joined when it is back.</p>}
      {room.lastResults && <ResultsTable race={room.lastResults} you={null} title="LAST RACE" />}
    </>
  );
}

function InRoom({ room }: { room: RoomState }) {
  const host = isHost(room);
  const me = room.players.find((p) => p.id === room.you) ?? null;
  // A friend who arrived by link joined before ever seeing the name card: ask here, once.
  const profile = useProfile();
  const asked = useFriendsProfile((s) => s.asked);
  const named = useFriendsProfile((s) => s.name);
  const askName = !asked && !named && needsNamePrompt(profile);
  const others = room.players.filter((p) => p.id !== room.you);
  const race = room.race;
  const phase = race?.phase ?? 'lobby';
  const trackId = race?.track ?? null;
  const track = trackId ? getTrackEntry(trackId) : null;
  const roam = track?.mode === 'roam';
  const live = phase === 'countdown' || phase === 'racing';
  const present = others.filter((p) => !p.away);
  const readyPresent = present.filter((p) => p.ready).length;
  const canStart = host && !live && !roam && readyPresent === present.length;
  const setTab = useHudUi((s) => s.setMenuTab);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const share = roomActions.shareUrl() ?? '';
  const count = seatCount(room.players.length, room.size);
  const heir = host ? nextHost(room) : null;
  const manage = host && room.seats && !live;
  const leave = () => {
    if (heir && !confirmLeave) {
      setConfirmLeave(true);
      return;
    }
    roomActions.leave(heir?.id);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(share);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard permission: the link text is selectable.
    }
  };

  const shownRace = phase === 'results' ? race : live && race && race.results.length > 0 ? race : room.lastResults;
  // Away seats count toward the size: tell the host why a friend may be getting ROOM FULL.
  const fullWithAway = host && room.seats && room.size !== null && room.players.length >= room.size && others.some((p) => p.away);
  return (
    <>
      {askName && <NamePrompt current={me?.name} />}
      <div className="fr__code" data-testid="friends-code">
        <small>ROOM CODE</small>
        <b>{room.code}</b>
        <span className="fr__count" data-testid="friends-count">
          {count}
        </span>
      </div>
      <div className="fr__share">
        <div className="fr__share-text">
          <small>FRIENDS JOIN AT · {count}</small>
          <span data-testid="friends-share">{share}</span>
        </div>
        <button type="button" className="gm-btn" onClick={copy} data-testid="friends-copy">
          {copied ? 'COPIED' : 'COPY'}
        </button>
      </div>
      <div className="fr__status" data-testid="friends-status" data-phase={phase}>
        <span className={`fr__phase--${phase}`}>{PHASE_LABEL[phase]}</span>
        {track && (
          <span>
            · <b>{track.name.toUpperCase()}</b>
            {roam ? ' · FREE ROAM TOGETHER' : ''}
          </span>
        )}
        {phase === 'countdown' && race?.startAt !== null && race?.startAt !== undefined && <LightsIn startAt={race.startAt} />}
        {phase === 'racing' && race && (
          <span>
            · {race.results.filter((r) => r.finishMs !== null).length}/{race.results.length} FINISHED
          </span>
        )}
        {host && !live && (
          <button type="button" className="gm-btn" onClick={() => setTab('maps')} data-testid="friends-maps">
            {trackId ? 'CHANGE MAP →' : 'PICK A MAP →'}
          </button>
        )}
        {!host && !live && <span>· THE HOST PICKS THE MAP</span>}
      </div>
      {live && !room.participant && <p className="fr__note">THIS RACE STARTED WITHOUT YOU · DRIVE FREELY, THE NEXT ONE IS YOURS</p>}
      <div className="fr__listhead">
        <small>
          PLAYERS <b data-testid="friends-players-count">{count}</b>
        </small>
        <span className="fr__humans">{HUMANS_ONLY}</span>
      </div>
      {host && room.seats && room.size !== null && (
        <div className="fr__sizebox" data-testid="friends-room-sizebox">
          <small>
            ROOM SIZE · <b>{sizeLabel(room.size)}</b>
          </small>
          <SizePicker value={room.size} onPick={(n) => roomActions.setSize(n)} min={Math.max(2, room.players.length)} testId="friends-room-size" disabled={live} />
        </div>
      )}
      {fullWithAway && (
        <p className="fr__note" data-testid="friends-full-away">
          A RECONNECTING SEAT STILL COUNTS TOWARD {count}. If that friend is joining again from another browser, REMOVE the old seat.
        </p>
      )}
      <ul className="fr__players" data-testid="friends-players">
        {room.players.map((p, i) => (
          <PlayerRow key={p.id} player={p} index={i} you={p.id === room.you} manage={(manage || (host && room.seats && p.away === true)) && p.id !== room.you} />
        ))}
      </ul>
      <div className="fr__actions">
        <button type="button" className={`gm-btn fr__btn${me?.ready ? ' is-on' : ''}`} onClick={() => roomActions.ready(!me?.ready)} disabled={live} aria-pressed={me?.ready ?? false} data-testid="friends-ready">
          {me?.ready ? '✓ READY' : 'READY'}
        </button>
        {host ? (
          <button type="button" className="gm-btn gm-btn--primary fr__btn" onClick={() => roomActions.start()} disabled={!canStart} data-testid="friends-start">
            START
            <small>{roam ? 'NO RACE IN FREE ROAM' : present.length === 0 ? (others.length > 0 ? 'WAITING FOR FRIENDS' : 'SOLO RUN') : `${readyPresent}/${present.length} READY`}</small>
          </button>
        ) : (
          <button type="button" className="gm-btn fr__btn" disabled data-testid="friends-start">
            START
            <small>HOST ONLY</small>
          </button>
        )}
        <button type="button" className={`gm-btn fr__btn${confirmLeave ? ' is-warn' : ''}`} onClick={leave} data-testid="friends-leave">
          LEAVE
        </button>
      </div>
      {confirmLeave && heir && (
        <div className="fr__confirm" role="alertdialog" aria-label="Leave the room" data-testid="friends-leave-confirm">
          <span>
            Leave and hand the room to <b>{heir.name}</b>?
          </span>
          <div className="fr__row">
            <button type="button" className="gm-btn gm-btn--primary fr__btn" onClick={() => roomActions.leave(heir.id)} data-testid="friends-leave-yes">
              LEAVE
            </button>
            <button type="button" className="gm-btn fr__btn" onClick={() => setConfirmLeave(false)} data-testid="friends-leave-no">
              STAY
            </button>
          </div>
        </div>
      )}
      {shownRace && shownRace.results.length > 0 && <ResultsTable race={shownRace} you={room.you} title={shownRace.phase === 'results' ? 'RESULTS' : 'RACE · LIVE'} />}
    </>
  );
}

/** Seconds until the lights go out, from the relay clock (re-rendered 4× a second while counting). */
function LightsIn({ startAt }: { startAt: number }) {
  const [left, setLeft] = useState(() => startAt - relayNow());
  useEffect(() => {
    const timer = setInterval(() => setLeft(startAt - relayNow()), 250);
    return () => clearInterval(timer);
  }, [startAt]);
  return <span>· GO IN {Math.max(0, left / 1000).toFixed(1)} S</span>;
}

function PlayerRow({ player, index, you, manage }: { player: RoomPlayer; index: number; you: boolean; manage: boolean }) {
  const decoded = decodePlayer(player, index);
  const car = getCarEntry(resolveCarId(player.carId));
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const timer = setTimeout(() => setSure(false), 4000);
    return () => clearTimeout(timer);
  }, [sure]);
  return (
    <li className={`fr__player${you ? ' is-you' : ''}${player.away ? ' is-away' : ''}${manage ? ' has-actions' : ''}`} style={{ ['--accent' as string]: decoded.color }} data-testid={`friends-player-${player.id}`}>
      {decoded.avatar ? <img className="fr__avatar" src={portraitDataUrl(decoded.avatar)} alt="" width={40} height={40} /> : <span className="fr__avatar">{player.name.slice(0, 1).toUpperCase()}</span>}
      <div className="fr__who">
        <b>{player.name}</b>
        <small>
          {decoded.look.ride ? `${decoded.look.ride.name} (${car.name})` : car.name}
          {player.plate ? <i> · {player.plate}</i> : null}
        </small>
      </div>
      <div className="fr__tags">
        {player.isHost && <span className="fr__tag fr__tag--host">HOST</span>}
        {you && <span className="fr__tag fr__tag--you">YOU</span>}
        {player.away ? (
          <span className="fr__tag fr__tag--away" data-testid={`friends-away-${player.id}`}>
            RECONNECTING…
          </span>
        ) : (
          <span className={`fr__tag${player.ready ? ' fr__tag--ready' : ''}`} data-testid={`friends-ready-${player.id}`}>
            {player.ready ? '✓ READY' : 'NOT READY'}
          </span>
        )}
        {player.ping !== null && !player.away && <span className="fr__tag fr__tag--ping">{player.ping} MS</span>}
      </div>
      {manage && (
        <div className="fr__player-actions">
          <button type="button" className="gm-btn fr__mini" onClick={() => roomActions.makeHost(player.id)} disabled={player.away === true} data-testid={`friends-makehost-${player.id}`}>
            MAKE HOST
          </button>
          <button
            type="button"
            className={`gm-btn fr__mini${sure ? ' is-warn' : ''}`}
            onClick={() => {
              if (!sure) setSure(true);
              else roomActions.remove(player.id);
            }}
            data-testid={`friends-remove-${player.id}`}
          >
            {sure ? 'TAP TO REMOVE' : 'REMOVE'}
          </button>
        </div>
      )}
    </li>
  );
}

function ResultsTable({ race, you, title }: { race: RoomRace; you: string | null; title: string }) {
  const rows = sortedResults(race);
  const leader = rows[0]?.finishMs ?? null;
  return (
    <table className="fr__results" data-testid="friends-results" data-phase={race.phase}>
      <caption>
        {title}
        {race.track ? ` · ${getTrackEntry(race.track).name.toUpperCase()}` : ''}
      </caption>
      <thead>
        <tr>
          <th>POS</th>
          <th>NAME</th>
          <th>TIME</th>
          <th>GAP</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id} className={r.id === you ? 'is-you' : undefined} data-testid={`friends-result-${r.id}`}>
            <td className="fr__pos">{r.finishMs === null ? '—' : `P${positionOf(race, r.id) ?? i + 1}`}</td>
            <td className="fr__name">{r.name}</td>
            <td>{r.finishMs === null ? (race.phase === 'results' ? 'DNF' : '…') : formatRaceTime(r.finishMs)}</td>
            <td className="fr__gap">{r.finishMs === null || leader === null || i === 0 ? '' : `+${((r.finishMs - leader) / 1000).toFixed(1)} S`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
