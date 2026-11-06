/**
 * Per-car island records in localStorage (best-effort; blocked storage just means no records):
 *   tessera.air.v1  { [carId]: { [rampId]: { s, m } } }  best air time per ramp (and its distance)
 *   tessera.trap.v1 { [carId]: kmh }                     best Saltglass speed-trap pass
 */
const AIR_KEY = 'tessera.air.v1';
const TRAP_KEY = 'tessera.trap.v1';

type AirRecords = Record<string, Record<string, { s: number; m: number }>>;
type TrapRecords = Record<string, number>;

function read<T extends object>(key: string): T {
  try {
    const raw = window.localStorage.getItem(key);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? (v as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

function write(key: string, value: object): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked
  }
}

export function bestAir(carId: string, rampId: string): { s: number; m: number } | null {
  const r = read<AirRecords>(AIR_KEY)[carId]?.[rampId];
  return r && Number.isFinite(r.s) ? r : null;
}

/** Record an air time off a ramp; returns true when it is this car's new best on that ramp. */
export function recordAir(carId: string, rampId: string, seconds: number, metres: number): boolean {
  const all = read<AirRecords>(AIR_KEY);
  const prev = all[carId]?.[rampId];
  if (prev && Number.isFinite(prev.s) && prev.s >= seconds) return false;
  all[carId] = { ...(all[carId] ?? {}), [rampId]: { s: Math.round(seconds * 100) / 100, m: Math.round(metres * 10) / 10 } };
  write(AIR_KEY, all);
  return true;
}

export function bestTrap(carId: string): number | null {
  const v = read<TrapRecords>(TRAP_KEY)[carId];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Record a speed-trap pass; returns true when it is this car's new best. */
export function recordTrap(carId: string, kmh: number): boolean {
  const all = read<TrapRecords>(TRAP_KEY);
  const prev = all[carId];
  if (typeof prev === 'number' && prev >= kmh) return false;
  all[carId] = Math.round(kmh * 10) / 10;
  write(TRAP_KEY, all);
  return true;
}
