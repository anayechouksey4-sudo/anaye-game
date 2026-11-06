/**
 * DRIVERS: five rows (56 px) with a portrait, an editable name (tap = rename, touch keyboard,
 * 14 characters), the OWNER tag, a signature-colour dot and a one-line bio; DRIVE picks the
 * driver, LOOK opens the avatar builder under the row (skin, hair, helmet, visor, eyes, mouth,
 * glasses, beard, marks, colour) with a live portrait. SHARE / PASTE move a driver between phones
 * as a DRV1 code. Cosmetic only: no driver is faster than another.
 *
 * Standalone: reads and writes state/profile.ts; mount it as the ☰ GARAGE → DRIVERS segment (or
 * its own tab). Names are React text, never HTML.
 */
import './profile.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BEARDS,
  EYES,
  EYE_COLORS,
  GLASSES,
  HAIR_COLORS,
  HAIR_STYLES,
  HELMETS,
  MARKS,
  MOUTHS,
  SIGNATURE_COLORS,
  SKIN_TONES,
  VISORS,
  type AvatarConfig,
  type DriverProfile,
} from '../drivers/avatar';
import { portraitDataUrl } from '../drivers/portrait';
import { NAME_MAX, sanitizeName } from '../drivers/sanitize';
import { decodeDriver, encodeDriver, shareCodeKind } from '../drivers/shareCode';
import { useProfile } from '../state/profile';
import { decodeRide } from '../ride/shareCode';

const LABEL: Record<string, string> = {
  none: 'NONE',
  buzz: 'BUZZ',
  crop: 'CROP',
  quiff: 'QUIFF',
  curls: 'CURLS',
  bun: 'BUN',
  long: 'LONG',
  mohawk: 'MOHAWK',
  braid: 'BRAID',
  open: 'OPEN',
  full: 'FULL',
  cap: 'CAP',
  beanie: 'BEANIE',
  band: 'BAND',
  clear: 'CLEAR',
  cyan: 'CYAN',
  magenta: 'MAGENTA',
  gold: 'GOLD',
  dot: 'DOT',
  wide: 'WIDE',
  sleepy: 'SLEEPY',
  wink: 'WINK',
  star: 'STAR',
  grin: 'GRIN',
  smirk: 'SMIRK',
  flat: 'FLAT',
  tongue: 'TONGUE',
  round: 'ROUND',
  square: 'SQUARE',
  shades: 'SHADES',
  stubble: 'STUBBLE',
  goatee: 'GOATEE',
  freckles: 'FRECKLES',
  stripe: 'STRIPE',
  scar: 'SCAR',
  dots: 'DOTS',
};

export function Portrait({ avatar, big = false, testId }: { avatar: AvatarConfig; big?: boolean; testId?: string }) {
  const url = portraitDataUrl(avatar);
  return <img className={`pf-portrait${big ? ' pf-portrait--big' : ''}`} src={url || undefined} alt="" width={big ? 96 : 44} height={big ? 96 : 44} draggable={false} data-testid={testId} />;
}

/** A row of chips; `value` is the one that is on. */
export function Seg<T extends string>({ options, value, onPick, label, testId }: { options: readonly T[]; value: T; onPick: (v: T) => void; label: (v: T) => string; testId: string }) {
  return (
    <div className="pf-seg" role="radiogroup" data-testid={testId}>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} className={value === o ? 'is-on' : undefined} onClick={() => onPick(o)} data-testid={`${testId}-${o}`}>
          {label(o)}
        </button>
      ))}
    </div>
  );
}

export function Swatches({ colors, value, onPick, testId }: { colors: readonly string[]; value: string | number; onPick: (v: string, index: number) => void; testId: string }) {
  return (
    <div className="pf-swatches" role="radiogroup" data-testid={testId}>
      {colors.map((c, i) => {
        const on = typeof value === 'number' ? value === i : value.toUpperCase() === c.toUpperCase();
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={c}
            className={on ? 'is-on' : undefined}
            style={{ ['--swatch' as string]: c }}
            onClick={() => onPick(c, i)}
            data-testid={`${testId}-${i}`}
          />
        );
      })}
    </div>
  );
}

export function Field({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="pf-section">
      <h4 className="pf-section__title">
        {title}
        {aside !== undefined && <small>{aside}</small>}
      </h4>
      {children}
    </div>
  );
}

/**
 * A name that becomes a text field on tap: 14 characters, touch keyboard with DONE, commits on
 * Enter / blur through sanitizeName (an empty result keeps the old name), scrolls itself into the
 * middle of the panel on focus so the on-screen keyboard never covers it.
 */
export function NameEditor({ value, onCommit, testId, placeholder }: { value: string; onCommit: (name: string) => void; testId: string; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
      inputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [editing]);
  const commit = () => {
    const clean = sanitizeName(draft);
    if (clean && clean !== value) onCommit(clean);
    setEditing(false);
  };
  if (!editing)
    return (
      <button
        type="button"
        className="pf-name"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        aria-label={`Rename ${value}`}
        data-testid={testId}
      >
        {value}
        <small>✎</small>
      </button>
    );
  return (
    <input
      ref={inputRef}
      className="pf-input"
      type="text"
      value={draft}
      maxLength={NAME_MAX}
      enterKeyHint="done"
      autoComplete="off"
      autoCapitalize="words"
      autoCorrect="off"
      spellCheck={false}
      placeholder={placeholder}
      aria-label="Name"
      onChange={(e) => setDraft(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
        e.stopPropagation();
      }}
      onKeyUp={(e) => e.stopPropagation()}
      onBlur={commit}
      data-testid={`${testId}-input`}
    />
  );
}

function AvatarBuilder({ driver }: { driver: DriverProfile }) {
  const setAvatar = useProfile((s) => s.setDriverAvatar);
  const resetDriver = useProfile((s) => s.resetDriver);
  const a = driver.avatar;
  const patch = (p: Partial<AvatarConfig>) => setAvatar(driver.id, { ...a, ...p });
  const label = (v: string) => LABEL[v] ?? v.toUpperCase();
  return (
    <div className="pf-builder" data-testid={`driver-builder-${driver.id}`}>
      <div className="pf-builder__head">
        <Portrait avatar={a} big testId={`driver-portrait-big-${driver.id}`} />
        <p className="pf-note">
          Faces here are built from blocks, not photos. Mix the pieces to make a look-alike of a friend, then rename the slot after them. The same
          head sits in the cockpit.
        </p>
      </div>
      <Field title="SIGNATURE COLOUR">
        <Swatches colors={SIGNATURE_COLORS} value={a.color} onPick={(c) => patch({ color: c })} testId={`av-color-${driver.id}`} />
      </Field>
      <Field title="SKIN">
        <Swatches colors={SKIN_TONES} value={a.skin} onPick={(_c, i) => patch({ skin: i })} testId={`av-skin-${driver.id}`} />
      </Field>
      <Field title="HAIR" aside={a.helmet === 'full' || a.helmet === 'beanie' ? 'hidden under the helmet' : undefined}>
        <Seg options={HAIR_STYLES} value={a.hair} onPick={(hair) => patch({ hair })} label={label} testId={`av-hair-${driver.id}`} />
        <Swatches colors={HAIR_COLORS} value={a.hairColor} onPick={(_c, i) => patch({ hairColor: i })} testId={`av-haircolor-${driver.id}`} />
      </Field>
      <Field title="HELMET / HAT">
        <Seg options={HELMETS} value={a.helmet} onPick={(helmet) => patch({ helmet })} label={label} testId={`av-helmet-${driver.id}`} />
      </Field>
      {a.helmet === 'full' && (
        <Field title="VISOR">
          <Seg options={VISORS} value={a.visor} onPick={(visor) => patch({ visor })} label={label} testId={`av-visor-${driver.id}`} />
        </Field>
      )}
      <Field title="EYES">
        <Seg options={EYES} value={a.eyes} onPick={(eyes) => patch({ eyes })} label={label} testId={`av-eyes-${driver.id}`} />
        <Swatches colors={EYE_COLORS} value={a.eyeColor} onPick={(_c, i) => patch({ eyeColor: i })} testId={`av-eyecolor-${driver.id}`} />
      </Field>
      <Field title="MOUTH">
        <Seg options={MOUTHS} value={a.mouth} onPick={(mouth) => patch({ mouth })} label={label} testId={`av-mouth-${driver.id}`} />
      </Field>
      <Field title="GLASSES">
        <Seg options={GLASSES} value={a.glasses} onPick={(glasses) => patch({ glasses })} label={label} testId={`av-glasses-${driver.id}`} />
      </Field>
      <Field title="BEARD">
        <Seg options={BEARDS} value={a.beard} onPick={(beard) => patch({ beard })} label={label} testId={`av-beard-${driver.id}`} />
      </Field>
      <Field title="MARKS">
        <Seg options={MARKS} value={a.mark} onPick={(mark) => patch({ mark })} label={label} testId={`av-mark-${driver.id}`} />
      </Field>
      <div className="pf-actions">
        <button type="button" className="pf-btn" onClick={() => resetDriver(driver.id)} data-testid={`driver-reset-${driver.id}`}>
          RESET SLOT
        </button>
      </div>
    </div>
  );
}

function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false);
  } catch {
    // fall through
  }
  return Promise.resolve(false);
}

/** COPY CODE / PASTE CODE for one driver slot. */
function DriverShare({ driver }: { driver: DriverProfile }) {
  const importDriver = useProfile((s) => s.importDriver);
  const importRide = useProfile((s) => s.importRideCode);
  const [paste, setPaste] = useState('');
  const [status, setStatus] = useState<{ text: string; bad: boolean }>({ text: '', bad: false });
  const code = encodeDriver({ name: driver.name, avatar: driver.avatar });
  const apply = () => {
    const kind = shareCodeKind(paste);
    if (kind === 'driver') {
      const d = decodeDriver(paste);
      if (d) {
        importDriver(driver.id, d);
        setStatus({ text: `IMPORTED ${d.name || driver.name}`.toUpperCase(), bad: false });
        setPaste('');
        return;
      }
    } else if (kind === 'ride') {
      const r = decodeRide(paste);
      if (r && importRide(paste)) {
        setStatus({ text: `THAT WAS A RIDE CODE: ${r.ride.name.toUpperCase()} IS NOW IN MY RIDE`, bad: false });
        setPaste('');
        return;
      }
    }
    setStatus({ text: 'NOT A VALID CODE', bad: true });
  };
  return (
    <div className="pf-code pf-code--attached" data-testid={`driver-share-${driver.id}`}>
      <span className="pf-code__title">SHARE {driver.name.toUpperCase()} · PASTE A FRIEND</span>
      <code data-testid={`driver-code-${driver.id}`}>{code}</code>
      <div className="pf-actions">
        <button
          type="button"
          className="pf-btn"
          onClick={() => void copyText(code).then((ok) => setStatus({ text: ok ? 'COPIED' : 'LONG-PRESS THE CODE TO COPY', bad: !ok }))}
          data-testid={`driver-copy-${driver.id}`}
        >
          COPY CODE
        </button>
      </div>
      <div className="pf-field">
        <input
          className="pf-input"
          type="text"
          value={paste}
          placeholder="PASTE A FRIEND'S CODE"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-label="Paste a share code"
          onChange={(e) => setPaste(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply();
            e.stopPropagation();
          }}
          onKeyUp={(e) => e.stopPropagation()}
          onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
          data-testid={`driver-paste-${driver.id}`}
        />
        <button type="button" className="pf-btn" onClick={apply} disabled={!paste.trim()} data-testid={`driver-paste-apply-${driver.id}`}>
          APPLY
        </button>
      </div>
      <span className={`pf-code__status${status.bad ? ' is-bad' : ''}`} data-testid={`driver-share-status-${driver.id}`}>
        {status.text}
      </span>
    </div>
  );
}

function DriverRow({ driver, active, open, onToggle }: { driver: DriverProfile; active: boolean; open: boolean; onToggle: () => void }) {
  const rename = useProfile((s) => s.renameDriver);
  const setActive = useProfile((s) => s.setActiveDriver);
  return (
    <div data-testid={`driver-${driver.id}`}>
      <div className={`pf-row${active ? ' is-active' : ''}`} style={{ ['--accent' as string]: driver.avatar.color }}>
        <Portrait avatar={driver.avatar} testId={`driver-portrait-${driver.id}`} />
        <div className="pf-row__main">
          <div className="pf-row__name">
            <NameEditor value={driver.name} onCommit={(name) => rename(driver.id, name)} testId={`driver-name-${driver.id}`} />
          </div>
          <span className="pf-bio">
            {driver.owner && <span className="pf-tag">OWNER</span>}
            {active && <span className="pf-tag pf-tag--on">DRIVING</span>}
            {driver.bio}
          </span>
        </div>
        <div className="pf-row__actions">
          <button
            type="button"
            className={`pf-btn pf-btn--icon${active ? ' is-on' : ''}`}
            style={{ ['--accent' as string]: driver.avatar.color }}
            onClick={() => setActive(driver.id)}
            aria-pressed={active}
            aria-label={active ? `${driver.name} is driving` : `Drive as ${driver.name}`}
            title="Drive"
            data-testid={`driver-pick-${driver.id}`}
          >
            {active ? '✓' : '▶'}
          </button>
          <button
            type="button"
            className={`pf-btn pf-btn--icon${open ? ' is-on' : ''}`}
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`Edit ${driver.name}'s look and share code`}
            title="Look and share"
            data-testid={`driver-look-${driver.id}`}
          >
            ✎
          </button>
        </div>
      </div>
      {open && (
        <>
          <AvatarBuilder driver={driver} />
          <DriverShare driver={driver} />
        </>
      )}
    </div>
  );
}

export function DriversTab() {
  const drivers = useProfile((s) => s.drivers);
  const activeId = useProfile((s) => s.activeDriverId);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="pf" data-testid="drivers-tab">
      <p className="pf-lead">
        <b>LOOKS AND BANNERS ONLY · NO SPEED BONUS.</b> Tap a name to rename it and put your friends in; ▶ picks who drives; ✎ builds the face from
        blocks (no photos) and shows the share code. The driver you pick sits in every car.
      </p>
      {drivers.map((d) => (
        <DriverRow key={d.id} driver={d} active={d.id === activeId} open={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} />
      ))}
    </div>
  );
}
