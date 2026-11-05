const MINUS = '−';

/** Thousands grouping without Intl (Hermes on older Android ships a partial Intl). */
function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '—';
  const fixed = Math.abs(value).toFixed(decimals);
  const [intPart = '0', frac] = fixed.split('.');
  const body = frac ? `${group(intPart)}.${frac}` : group(intPart);
  return value < 0 && Number(fixed) !== 0 ? `${MINUS}${body}` : body;
}

/** Explicit sign, typographic minus: +1,234 / −567 / 0. */
export function formatSigned(value: number, decimals = 0): string {
  const body = formatNumber(value, decimals);
  if (!Number.isFinite(value) || Number(Math.abs(value).toFixed(decimals)) === 0) return body;
  return value > 0 ? `+${body}` : body;
}

/** 83456 → "1:23.456"; null → "--:--.---". */
export function formatLapTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '--:--.---';
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function formatKmh(kmh: number): string {
  return Number.isFinite(kmh) ? formatNumber(kmh, 0) : '∞';
}

/** Chassis balance as the readout shows it: "+12", "−8", "0". */
export function formatBalance(value: number): string {
  return formatSigned(value, 0);
}
