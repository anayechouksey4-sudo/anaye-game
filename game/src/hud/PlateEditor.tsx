/**
 * Number-plate editor for one car: a plate chip + ✎ PLATE, expanding to an inline text field with
 * RANDOM / RESET / DONE. Touch-first (44 px targets, a ≥ 16 px field so Android/iOS don't zoom,
 * `enterKeyHint="done"`, scrolls itself into view when the keyboard opens). Standalone: it owns its
 * CSS (plateEditor.css), reads and writes the selection store (`plates`, `setPlate`) and the catalog
 * default; mount it anywhere outside a <button> (the garage card is one, so put it next to the
 * selected card, or under the GARAGE lead line, with the card's `--accent`). Live-normalized: what
 * you type is upper-cased and filtered as you type (car/plates/plateText), and the car's plate
 * updates on every keystroke. Game key bindings ignore events from inputs (car/input.ts).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { getCarEntry } from '../car/catalog';
import { defaultPlateFor, usePlateText } from '../car/plates/platePick';
import { PLATE_MAX_LENGTH, normalizePlate, randomPlate } from '../car/plates/plateText';
import { useSelection } from '../state/selection';
import './plateEditor.css';

/** Typing form: upper-case + allowed characters, but one trailing space survives so words can be typed. */
function softNormalize(raw: string): string {
  const clean = raw
    .toUpperCase()
    .replace(/[-_./·]+/g, ' ')
    .replace(/[^A-Z0-9 ]+/g, '')
    .replace(/ {2,}/g, ' ')
    .replace(/^ +/, '')
    .slice(0, PLATE_MAX_LENGTH);
  return clean;
}

export interface PlateEditorProps {
  carId: string;
  /** Start expanded (the lab page / tests). */
  open?: boolean;
  /** Called after DONE. */
  onDone?: () => void;
}

export function PlateEditor({ carId, open = false, onDone }: PlateEditorProps) {
  const entry = getCarEntry(carId);
  const plate = usePlateText(carId);
  const custom = useSelection((s) => s.plates[carId]);
  const setPlate = useSelection((s) => s.setPlate);
  const [editing, setEditing] = useState(open);
  const [draft, setDraft] = useState(plate);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  // Opening the editor starts from the plate as it is now.
  useEffect(() => {
    if (editing) setDraft(normalizePlate(plate) || plate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [editing]);

  const commit = (raw: string) => {
    const soft = softNormalize(raw);
    setDraft(soft);
    setPlate(carId, soft);
  };

  const done = () => {
    const finalText = setPlate(carId, draft);
    setDraft(finalText || defaultPlateFor(carId));
    inputRef.current?.blur();
    setEditing(false);
    onDone?.();
  };

  const style = { ['--accent' as string]: entry.accent };

  if (!editing) {
    return (
      <div className="pe" style={style} data-testid={`plate-editor-${carId}`}>
        <span className="pe__k">PLATE</span>
        <span className="pe__chip" data-testid={`plate-chip-${carId}`}>
          {plate}
        </span>
        <span className="pe__name">{custom ? 'your plate' : 'default plate'} · {entry.name}</span>
        <button type="button" className="pe__btn" onClick={() => setEditing(true)} data-testid={`plate-edit-${carId}`} aria-label={`Edit the number plate of the ${entry.name}`}>
          ✎ PLATE
        </button>
      </div>
    );
  }

  return (
    <div className="pe" style={style} data-testid={`plate-editor-${carId}`}>
      <span className="pe__k">PLATE</span>
      <span className="pe__chip" aria-hidden="true">
        {plate}
      </span>
      <span className="pe__name">{entry.name}</span>
      <div className="pe__edit">
        <input
          ref={inputRef}
          id={inputId}
          className="pe__input"
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={PLATE_MAX_LENGTH}
          enterKeyHint="done"
          pattern="[A-Za-z0-9 ]*"
          placeholder={defaultPlateFor(carId)}
          aria-label="Number plate"
          value={draft}
          onChange={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              done();
            }
          }}
          onBlur={() => setDraft((d) => normalizePlate(d) || d)}
          data-testid={`plate-input-${carId}`}
        />
        <button type="button" className="pe__btn" onClick={() => commit(randomPlate())} data-testid={`plate-random-${carId}`}>
          RANDOM
        </button>
        <button type="button" className="pe__btn" onClick={() => commit('')} data-testid={`plate-reset-${carId}`} disabled={!custom && draft === ''}>
          RESET
        </button>
        <button type="button" className="pe__btn pe__btn--done" onClick={done} data-testid={`plate-done-${carId}`}>
          DONE
        </button>
      </div>
      <span className="pe__hint">
        A–Z, 0–9 and spaces, up to <b>{PLATE_MAX_LENGTH}</b> characters · <b>{normalizePlate(draft).length}</b>/{PLATE_MAX_LENGTH} · empty = the default <b>{defaultPlateFor(carId)}</b>
      </span>
    </div>
  );
}
