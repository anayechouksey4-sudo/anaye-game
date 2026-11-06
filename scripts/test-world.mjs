#!/usr/bin/env node
// Runs the Tessera Isle generator test (game/test/world.test.ts) with tsx, which the dashboard's
// install provides. On a phone that skipped the dashboard install there is no tsx, so the test is
// skipped with a note instead of failing `npm test`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
const tsx = ['dashboard', 'game', '.']
  .map((pkg) => path.join(root, pkg, 'node_modules', '.bin', bin))
  .find((p) => existsSync(p));

if (!tsx) {
  console.log('world test skipped: tsx is not installed (it comes with the dashboard install, `npm run setup`).');
  process.exit(0);
}

const result = spawnSync(tsx, ['--tsconfig', 'game/tsconfig.app.json', '--test', 'game/test/world.test.ts'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
