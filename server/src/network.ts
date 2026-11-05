import { networkInterfaces } from 'node:os';

export interface LanAddress {
  interfaceName: string;
  address: string;
}

/** Non-internal IPv4 addresses of this machine — the hosts a phone on the same network can reach. */
export function lanIPv4Addresses(): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [interfaceName, infos] of Object.entries(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) out.push({ interfaceName, address: info.address });
    }
  }
  return out;
}

/** Host part of a URL for a bind address; wildcard binds are reachable locally as `localhost`. */
export function displayHost(bindHost: string): string {
  if (bindHost === '0.0.0.0' || bindHost === '::' || bindHost === '') return 'localhost';
  return bindHost.includes(':') ? `[${bindHost}]` : bindHost;
}
