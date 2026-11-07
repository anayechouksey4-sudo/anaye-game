/**
 * Three-second HUD chip for input events: GAMEPAD CONNECTED / DISCONNECTED, TILT NOT ALLOWED,
 * TILT CALIBRATED. Reads the bus notice; the integrator mounts it in HUD.tsx (it positions itself
 * under the top bar, centred, pointer-events none).
 */
import { useEffect, useReducer } from 'react';
import { useInputStatus } from './inputBus';
import './input.css';

export default function InputChip() {
  const { notice } = useInputStatus();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(rerender, Math.max(0, notice.until - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!notice || Date.now() >= notice.until) return null;
  return (
    <div className="inchip" role="status" data-testid="input-chip" key={notice.id}>
      {notice.text}
    </div>
  );
}
