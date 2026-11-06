/**
 * DEV ONLY — /lab-plates.html (Vite dev server; not in the production build, which only bundles
 * index.html). Mounts the PlateEditor for every catalog car with a 2-D preview of the exact plate
 * drawing the 3-D texture uses (plateDraw), and shows what the selection store persisted, so the
 * editor can be exercised by real touch and across reloads without the game running.
 */
import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { CAR_CATALOG } from '../car/catalog';
import { drawPlate } from '../car/plates/plateDraw';
import { usePlateText } from '../car/plates/platePick';
import { PlateEditor } from '../hud/PlateEditor';
import { useSelection } from '../state/selection';
import '../styles.css';
import '../hud/hud.css';

declare global {
  interface Window {
    /** Lab counters: how long the last 2-D plate draw took (ms) and how many were drawn. */
    __PLATELAB__?: { lastDrawMs: number; draws: number };
  }
}

function PlatePreview({ carId, accent }: { carId: string; accent: string }) {
  const text = usePlateText(carId);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const t0 = performance.now();
    drawPlate(ctx, text, accent, 256, 64);
    const lab = (window.__PLATELAB__ ??= { lastDrawMs: 0, draws: 0 });
    lab.lastDrawMs = Math.round((performance.now() - t0) * 100) / 100;
    lab.draws++;
  }, [text, accent]);
  return <canvas ref={ref} width={256} height={64} style={{ width: 256, height: 64, imageRendering: 'pixelated', borderRadius: 4 }} data-testid={`plate-preview-${carId}`} data-plate={text} />;
}

function Saved() {
  const plates = useSelection((s) => s.plates);
  let raw = '';
  try {
    raw = window.localStorage.getItem('squadhq.selection.v1') ?? '(nothing saved)';
  } catch {
    raw = '(storage blocked)';
  }
  return (
    <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', opacity: 0.8 }} data-testid="plates-saved">
      plates in store: {JSON.stringify(plates)}
      {'\n'}localStorage: {raw}
    </pre>
  );
}

function Lab() {
  return (
    <div className="hud" style={{ position: 'static', minHeight: '100vh', padding: 16, overflow: 'auto', pointerEvents: 'auto', touchAction: 'pan-y' }}>
      <h1 style={{ fontSize: 16, letterSpacing: '0.2em', margin: '0 0 12px' }}>LAB · NUMBER PLATES</h1>
      <p style={{ fontSize: 11, opacity: 0.7, margin: '0 0 16px' }}>Dev page. Each row: the plate as the 3-D texture draws it, then the editor the garage mounts. Changes persist in squadhq.selection.v1.</p>
      <Saved />
      {CAR_CATALOG.map((c) => (
        <section key={c.id} style={{ margin: '0 0 18px', display: 'grid', gap: 8 }} data-testid={`lab-row-${c.id}`}>
          <PlatePreview carId={c.id} accent={c.accent} />
          <PlateEditor carId={c.id} />
        </section>
      ))}
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from lab-plates.html');
createRoot(root).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
);
