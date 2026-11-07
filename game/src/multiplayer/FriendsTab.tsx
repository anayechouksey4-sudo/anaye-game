/**
 * FRIENDS tab of the ☰ menu (mounted by GameMenu): host a room, join by code, see who is in, READY,
 * START (host), LEAVE, the share link and the results table. Offline / unlinked it explains how to
 * reach a relay. Every control is ≥ 44 px (menu.css buttons, 46 px fields); fits 360×640 and 740×280.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ROOM_CODE_LENGTH, type RoomPlayer, type RoomRace } from '@shared/protocol';
import { getCarEntry, resolveCarId } from '../car/catalog';
import { portraitDataUrl } from '../drivers/portrait';
import { LinkStatusBadge } from '../hud/LinkPanel';
import { formatRaceTime } from '../hud/hudUtils';
import { useHudUi } from '../hud/uiStore';
import { useGameStore } from '../state/store';
import { getTrackEntry } from '../track/catalog';
import { decodePlayer } from './identity';
import { relayNow, roomActions } from './roomClient';
import { isFramed, PUBLIC_GAME_URL, promptInstall, usePwa } from '../pwa/register';
import { isHost, positionOf, sortedResults, useRoom, type RoomState } from './roomStore';

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

const PHASE_LABEL: Record<RoomRace['phase'], string> = { lobby: 'LOBBY', countdown: 'LIGHTS', racing: 'RACE ON', results: 'RESULTS' };

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
      {linkStatus !== 'connected' ? <ConnectHelp linkStatus={linkStatus} /> : room.status === 'in-room' ? <InRoom room={room} /> : <Entry room={room} />}
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

/** No socket: how to get one (same Wi-Fi via dev:all, or a relay address). */
function ConnectHelp({ linkStatus }: { linkStatus: string }) {
  const [address, setAddress] = useState(() => savedRelay());
  const remembered = savedRelay();
  const connect = (e: FormEvent) => {
    e.preventDefault();
    const value = address.trim();
    if (!value) return;
    rememberRelay(value);
    reloadWithRelay(value);
  };
  return (
    <>
      <p className="fr__lead">
        {linkStatus === 'disabled' ? (
          <>
            <b>OFFLINE MODE.</b> Playing with friends needs the relay that comes with the game.
          </>
        ) : linkStatus === 'connecting' ? (
          <>
            <b>CONNECTING TO THE RELAY…</b> Rooms open as soon as it answers.
          </>
        ) : (
          <>
            <b>NO RELAY REACHED.</b> It retries on its own; check the address below.
          </>
        )}
      </p>
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

/** Connected, not in a room: host or join. */
function Entry({ room }: { room: RoomState }) {
  const [code, setCode] = useState(room.pendingCode ?? '');
  const joining = room.status === 'joining';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    roomActions.join(code);
  };
  return (
    <>
      <p className="fr__lead">
        Race the same map at the same time. Everyone drives their own car; the others appear as ghost cars (no collisions). The dashboard still tunes every car in the room.
      </p>
      <button type="button" className="gm-btn gm-btn--primary fr__btn fr__btn--host" onClick={() => roomActions.host()} disabled={joining} data-testid="friends-host">
        {joining ? 'ONE MOMENT…' : 'HOST A ROOM'}
        <small>YOU PICK THE MAP · FRIENDS JOIN BY CODE</small>
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
      {room.left === 'link' && <p className="fr__note">The relay link dropped; the room is re-joined when it is back.</p>}
      {room.lastResults && <ResultsTable race={room.lastResults} you={null} title="LAST RACE" />}
    </>
  );
}

function InRoom({ room }: { room: RoomState }) {
  const host = isHost(room);
  const me = room.players.find((p) => p.id === room.you) ?? null;
  const others = room.players.filter((p) => p.id !== room.you);
  const readyOthers = others.filter((p) => p.ready).length;
  const race = room.race;
  const phase = race?.phase ?? 'lobby';
  const trackId = race?.track ?? null;
  const track = trackId ? getTrackEntry(trackId) : null;
  const roam = track?.mode === 'roam';
  const live = phase === 'countdown' || phase === 'racing';
  const canStart = host && !live && !roam && readyOthers === others.length;
  const setTab = useHudUi((s) => s.setMenuTab);
  const [copied, setCopied] = useState(false);
  const share = roomActions.shareUrl() ?? '';

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
  return (
    <>
      <div className="fr__code" data-testid="friends-code">
        <small>ROOM CODE</small>
        <b>{room.code}</b>
      </div>
      <div className="fr__share">
        <div className="fr__share-text">
          <small>FRIENDS JOIN AT</small>
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
      <ul className="fr__players" data-testid="friends-players">
        {room.players.map((p, i) => (
          <PlayerRow key={p.id} player={p} index={i} you={p.id === room.you} />
        ))}
      </ul>
      <div className="fr__actions">
        <button type="button" className={`gm-btn fr__btn${me?.ready ? ' is-on' : ''}`} onClick={() => roomActions.ready(!me?.ready)} disabled={live} aria-pressed={me?.ready ?? false} data-testid="friends-ready">
          {me?.ready ? '✓ READY' : 'READY'}
        </button>
        {host ? (
          <button type="button" className="gm-btn gm-btn--primary fr__btn" onClick={() => roomActions.start()} disabled={!canStart} data-testid="friends-start">
            START
            <small>{roam ? 'NO RACE IN FREE ROAM' : others.length === 0 ? 'SOLO RUN' : `${readyOthers}/${others.length} READY`}</small>
          </button>
        ) : (
          <button type="button" className="gm-btn fr__btn" disabled data-testid="friends-start">
            START
            <small>HOST ONLY</small>
          </button>
        )}
        <button type="button" className="gm-btn fr__btn" onClick={() => roomActions.leave()} data-testid="friends-leave">
          LEAVE
        </button>
      </div>
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

function PlayerRow({ player, index, you }: { player: RoomPlayer; index: number; you: boolean }) {
  const decoded = decodePlayer(player, index);
  const car = getCarEntry(resolveCarId(player.carId));
  return (
    <li className={`fr__player${you ? ' is-you' : ''}`} style={{ ['--accent' as string]: decoded.color }} data-testid={`friends-player-${player.id}`}>
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
        <span className={`fr__tag${player.ready ? ' fr__tag--ready' : ''}`} data-testid={`friends-ready-${player.id}`}>
          {player.ready ? '✓ READY' : 'NOT READY'}
        </span>
        {player.ping !== null && <span className="fr__tag fr__tag--ping">{player.ping} MS</span>}
      </div>
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
