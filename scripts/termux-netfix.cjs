'use strict';
// Preloaded into every dev process by scripts/dev-all.mjs (via NODE_OPTIONS=--require).
//
// On Android, Termux can be denied the netlink call behind os.networkInterfaces(); Node then throws
// "uv_interface_addresses returned Unknown system error 13", which crashes `vite --host`, the Expo
// CLI and the relay's startup banner. When (and only when) the real call throws, answer with
// loopback plus the LAN address the launcher found another way (SQUAD_LAN_IP), if any.

const os = require('node:os');
const { syncBuiltinESMExports } = require('node:module');

const realNetworkInterfaces = os.networkInterfaces;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function fallbackInterfaces() {
  const interfaces = {
    lo: [
      {
        address: '127.0.0.1',
        netmask: '255.0.0.0',
        family: 'IPv4',
        mac: '00:00:00:00:00:00',
        internal: true,
        cidr: '127.0.0.1/8',
      },
    ],
  };
  const lanIp = process.env.SQUAD_LAN_IP;
  if (lanIp && IPV4.test(lanIp)) {
    interfaces.wlan0 = [
      {
        address: lanIp,
        netmask: '255.255.255.0',
        family: 'IPv4',
        mac: '00:00:00:00:00:00',
        internal: false,
        cidr: `${lanIp}/24`,
      },
    ];
  }
  return interfaces;
}

os.networkInterfaces = function networkInterfaces() {
  try {
    return realNetworkInterfaces.call(os);
  } catch {
    return fallbackInterfaces();
  }
};

// Propagate the patch to `import { networkInterfaces } from 'node:os'` in ESM code (Vite, the relay).
syncBuiltinESMExports();
