import { colors } from '../theme';
import type { LinkStatus } from '../net/squadLink';

export interface StatusLook {
  label: string;
  color: string;
  pulse: boolean;
}

/** CONNECTING / ONLINE / OFFLINE / RETRY IN Ns. */
export function describeLinkStatus(status: LinkStatus, retryAt: number | null, now: number): StatusLook {
  switch (status) {
    case 'online':
      return { label: 'ONLINE', color: colors.green, pulse: false };
    case 'connecting':
      return { label: 'CONNECTING', color: colors.yellow, pulse: true };
    case 'retrying': {
      const seconds = retryAt === null ? 0 : Math.max(0, Math.ceil((retryAt - now) / 1000));
      return { label: `RETRY IN ${seconds}s`, color: colors.yellow, pulse: true };
    }
    case 'offline':
      return { label: 'OFFLINE', color: colors.magenta, pulse: false };
  }
}
