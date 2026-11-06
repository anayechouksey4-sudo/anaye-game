/**
 * MY RIDE: build a custom car over any class — base, paint (primary / secondary / accent), neon
 * trim, wheels + rim colour, spoiler, exhaust tips, stance, name and plate — with a live 3D
 * preview (ride/RidePreview.tsx, debounced rebuilds) and a RIDE1 share code to paste to a friend.
 * The ride keeps its base class's handling, times and medals exactly.
 *
 * Standalone: reads and writes state/profile.ts. Mounting MY RIDE = `setRideActive(true)` plus the
 * base class as the selected car (the integration agent wires `useSelection().setCar(ride.base)`
 * and the look into CarModel; see the mount list in the report).
 */
import './profile.css';
import { useEffect, useState } from 'react';
import { CAR_CATALOG } from '../car/catalog';
import type { AvatarConfig } from '../drivers/avatar';
import { NAME_MAX, PLATE_MAX, sanitizeName, sanitizePlate } from '../drivers/sanitize';
import { shareCodeKind } from '../drivers/shareCode';
import { useActiveDriver, useProfile } from '../state/profile';
import {
  EXHAUSTS,
  PAINT_SWATCHES,
  STANCE_MAX,
  STANCE_MIN,
  STANCE_STEP,
  TRIMS,
  WHEEL_STYLES,
  clampStance,
  isCarClassIdSafe,
  spoilersFor,
  type RideConfig,
} from '../ride/config';
import { RidePreview } from '../ride/RidePreview';
import { encodeRide } from '../ride/shareCode';
import { Field, Seg, Swatches } from './DriversTab';

const LABEL: Record<string, string> = {
  none: 'NONE',
  cyan: 'CYAN',
  magenta: 'MAGENTA',
  yellow: 'YELLOW',
  green: 'GREEN',
  white: 'WHITE',
  accent: 'ACCENT',
  stock: 'STOCK',
  spoke5: '5 SPOKE',
  spoke6: '6 SPOKE',
  disc: 'DISC',
  turbofan: 'TURBOFAN',
  knobby: 'KNOBBY',
  retro: 'RETRO',
  lip: 'LIP',
  gt: 'GT WING',
  fin: 'FIN',
  single: 'SINGLE',
  twin: 'TWIN',
  quad: 'QUAD',
};
const label = (v: string) => LABEL[v] ?? v.toUpperCase();

type PaintSlot = 'paint' | 'paint2' | 'accent';
const PAINT_SLOTS: readonly { id: PaintSlot; label: string }[] = [
  { id: 'paint', label: 'BODY' },
  { id: 'paint2', label: 'SECOND' },
  { id: 'accent', label: 'ACCENT' },
];

function TextField({ value, onCommit, max, placeholder, plate = false, testId }: { value: string; onCommit: (v: string) => void; max: number; placeholder: string; plate?: boolean; testId: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const commit = () => {
    if (draft !== null) onCommit(draft);
    setDraft(null);
  };
  return (
    <div className="pf-field">
      <input
        className={`pf-input${plate ? ' pf-input--plate' : ''}`}
        type="text"
        value={shown}
        maxLength={max}
        placeholder={placeholder}
        enterKeyHint="done"
        autoComplete="off"
        autoCapitalize={plate ? 'characters' : 'words'}
        autoCorrect="off"
        spellCheck={false}
        aria-label={placeholder}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          e.stopPropagation();
        }}
        onKeyUp={(e) => e.stopPropagation()}
        data-testid={testId}
      />
      <span className="pf-count" data-testid={`${testId}-count`}>
        {[...shown].length}/{max}
      </span>
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

function RideShare({ ride }: { ride: RideConfig }) {
  const importRide = useProfile((s) => s.importRideCode);
  const [paste, setPaste] = useState('');
  const [status, setStatus] = useState<{ text: string; bad: boolean }>({ text: '', bad: false });
  const code = encodeRide(ride);
  const apply = () => {
    if (shareCodeKind(paste) === 'driver') {
      setStatus({ text: 'THAT IS A DRIVER CODE: PASTE IT IN DRIVERS', bad: true });
      return;
    }
    if (importRide(paste)) {
      setStatus({ text: 'RIDE IMPORTED', bad: false });
      setPaste('');
    } else setStatus({ text: 'NOT A VALID RIDE CODE', bad: true });
  };
  return (
    <div className="pf-code" data-testid="ride-share">
      <code data-testid="ride-code">{code}</code>
      <div className="pf-actions">
        <button type="button" className="pf-btn" onClick={() => void copyText(code).then((ok) => setStatus({ text: ok ? 'COPIED' : 'LONG-PRESS THE CODE TO COPY', bad: !ok }))} data-testid="ride-copy">
          COPY CODE
        </button>
      </div>
      <div className="pf-field">
        <input
          className="pf-input"
          type="text"
          value={paste}
          placeholder="PASTE A RIDE CODE"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-label="Paste a ride code"
          onChange={(e) => setPaste(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply();
            e.stopPropagation();
          }}
          onKeyUp={(e) => e.stopPropagation()}
          onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
          data-testid="ride-paste"
        />
        <button type="button" className="pf-btn" onClick={apply} disabled={!paste.trim()} data-testid="ride-paste-apply">
          APPLY
        </button>
      </div>
      <span className={`pf-code__status${status.bad ? ' is-bad' : ''}`} data-testid="ride-share-status">
        {status.text}
      </span>
    </div>
  );
}

export interface RideTabProps {
  /**
   * The live 3D preview (its own small canvas): true = mount it (two frames after the tab paints,
   * behind a "building preview" veil until the car is drawn); 'button' = a SHOW 3D PREVIEW tap
   * mounts it, every time the tab opens (a second WebGL context compiles the car shader again: a
   * hitch on a phone, 5–6 s under software GL even on a repeat — measured in the integration
   * report, so the game menu uses this); false = fields only.
   */
  preview?: boolean | 'button';
  /** Called when the player taps DRIVE MY RIDE (the host selects `ride.base` and closes the menu). */
  onDrive?: (ride: RideConfig) => void;
}

/** The preview box: SHOW 3D button → deferred canvas behind a veil → live preview. */
function PreviewSlot({ mode, ride, driver, caption }: { mode: true | 'button'; ride: RideConfig; driver: AvatarConfig; caption: string }) {
  const [shown, setShown] = useState(mode === true);
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!shown) return undefined;
    // Two frames: the tab (and the veil) paint before the canvas is created and the shaders compile.
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setMounted(true));
    });
    return () => cancelAnimationFrame(raf);
  }, [shown]);
  if (!shown) {
    return (
      <div className="pf-preview pf-preview--off" data-testid="ride-preview-off">
        <button type="button" className="pf-btn pf-btn--wide pf-preview__show" onClick={() => setShown(true)} data-testid="ride-preview-show">
          SHOW 3D PREVIEW
        </button>
        <span className="pf-preview__hint" aria-hidden="true">
          THE CAR ON TRACK WEARS THE LOOK ANYWAY
        </span>
      </div>
    );
  }
  return (
    <div className="pf-preview-wrap" style={{ position: 'relative' }}>
      {mounted ? (
        <RidePreview ride={ride} driver={driver} onReady={() => setReady(true)} />
      ) : (
        <div className="pf-preview" />
      )}
      {!ready && (
        <div className="pf-preview__veil" data-testid="ride-preview-veil" aria-live="polite">
          <span>BUILDING PREVIEW…</span>
        </div>
      )}
      <div className="pf-preview__name" aria-hidden="true">
        <b>{ride.name}</b>
        <small>{caption}</small>
      </div>
      <span className="pf-preview__hint" aria-hidden="true">
        DRAG TO ORBIT
      </span>
    </div>
  );
}

export function RideTab({ preview = true, onDrive }: RideTabProps) {
  const ride = useProfile((s) => s.ride);
  const rideActive = useProfile((s) => s.rideActive);
  const setRide = useProfile((s) => s.setRide);
  const resetRide = useProfile((s) => s.resetRide);
  const setRideActive = useProfile((s) => s.setRideActive);
  const driver = useActiveDriver();
  const [paintSlot, setPaintSlot] = useState<PaintSlot>('paint');
  const base = CAR_CATALOG.find((c) => c.id === ride.base);
  const spoilers = spoilersFor(ride.base);
  const stancePos = ((ride.stance - STANCE_MIN) / (STANCE_MAX - STANCE_MIN)) * 100;
  return (
    <div className="pf" data-testid="ride-tab">
      <p className="pf-lead">
        <b>LOOKS ONLY.</b> Your ride drives exactly like its base car and shares its times and medals. Drag the preview to orbit; paste the code to a
        friend and they get the same car.
      </p>
      {preview && <PreviewSlot mode={preview} ride={ride} driver={driver.avatar} caption={`${base?.name.toUpperCase() ?? ride.base.toUpperCase()} HANDLING · ${driver.name.toUpperCase()}`} />}
      <div className="pf-actions">
        <button
          type="button"
          className={`pf-btn pf-btn--wide${rideActive ? ' is-on' : ' pf-btn--primary'}`}
          onClick={() => {
            setRideActive(true);
            onDrive?.(ride);
          }}
          data-testid="ride-drive"
        >
          {rideActive ? '✓ MY RIDE IS MOUNTED' : '▶ DRIVE MY RIDE'}
        </button>
        {rideActive && (
          <button type="button" className="pf-btn pf-btn--wide" onClick={() => setRideActive(false)} data-testid="ride-unmount">
            BACK TO THE STOCK CAR
          </button>
        )}
      </div>
      <Field title="BASE CAR" aside="handling, times and medals">
        <Seg
          options={CAR_CATALOG.map((c) => c.id)}
          value={ride.base}
          onPick={(id) => {
            if (isCarClassIdSafe(id)) setRide({ base: id, spoiler: spoilersFor(id).includes(ride.spoiler) ? ride.spoiler : 'stock' });
          }}
          label={(id) => CAR_CATALOG.find((c) => c.id === id)?.name.toUpperCase() ?? id}
          testId="ride-base"
        />
      </Field>
      <Field title="NAME" aside={`${NAME_MAX} characters`}>
        <TextField value={ride.name} onCommit={(v) => setRide({ name: sanitizeName(v) || ride.name })} max={NAME_MAX} placeholder="CAR NAME" testId="ride-name" />
      </Field>
      <Field title="PLATE" aside="A–Z 0–9, blank = the base car's plate">
        <TextField value={ride.plate} onCommit={(v) => setRide({ plate: sanitizePlate(v) })} max={PLATE_MAX} placeholder="UK 07 DW 2400" plate testId="ride-plate" />
      </Field>
      <Field title="PAINT">
        <Seg options={PAINT_SLOTS.map((p) => p.id)} value={paintSlot} onPick={setPaintSlot} label={(id) => PAINT_SLOTS.find((p) => p.id === id)?.label ?? id} testId="ride-paintslot" />
        <Swatches colors={PAINT_SWATCHES} value={ride[paintSlot]} onPick={(c) => setRide({ [paintSlot]: c })} testId={`ride-${paintSlot}`} />
      </Field>
      <Field title="NEON TRIM">
        <Seg options={TRIMS} value={ride.trim} onPick={(trim) => setRide({ trim })} label={label} testId="ride-trim" />
      </Field>
      <Field title="WHEELS">
        <Seg options={WHEEL_STYLES} value={ride.wheel} onPick={(wheel) => setRide({ wheel })} label={label} testId="ride-wheel" />
        <Swatches colors={PAINT_SWATCHES} value={ride.wheelColor} onPick={(c) => setRide({ wheelColor: c })} testId="ride-wheelcolor" />
      </Field>
      <Field title="SPOILER" aside={spoilers.length === 1 ? 'this car keeps its own wing' : undefined}>
        <Seg options={spoilers} value={ride.spoiler} onPick={(spoiler) => setRide({ spoiler })} label={label} testId="ride-spoiler" />
      </Field>
      <Field title="EXHAUST TIPS">
        <Seg options={EXHAUSTS} value={ride.exhaust} onPick={(exhaust) => setRide({ exhaust })} label={label} testId="ride-exhaust" />
      </Field>
      <Field title="STANCE" aside={`${ride.stance > 0 ? '+' : ''}${Math.round(ride.stance * 100)} cm body · wheels stay put`}>
        <div className="pf-stance">
          <button type="button" className="pf-btn" onClick={() => setRide({ stance: clampStance(ride.stance - STANCE_STEP) })} disabled={ride.stance <= STANCE_MIN} aria-label="Lower" data-testid="ride-stance-down">
            −
          </button>
          <div className="pf-stance__bar" aria-hidden="true">
            <i style={{ ['--pos' as string]: `${stancePos}%` }} />
          </div>
          <button type="button" className="pf-btn" onClick={() => setRide({ stance: clampStance(ride.stance + STANCE_STEP) })} disabled={ride.stance >= STANCE_MAX} aria-label="Raise" data-testid="ride-stance-up">
            +
          </button>
        </div>
      </Field>
      <Field title="SHARE">
        <RideShare ride={ride} />
      </Field>
      <div className="pf-actions">
        <button type="button" className="pf-btn" onClick={() => resetRide()} data-testid="ride-reset">
          RESET LOOK
        </button>
      </div>
    </div>
  );
}
