#!/usr/bin/env node
// Builds the game for GitHub Pages into docs/ (the folder GitHub Pages can serve from any branch).
//
//   node scripts/build-pages.mjs
//
// Then commit docs/ and push. With Settings → Pages set to "Deploy from a branch" / this branch /
// "/docs", the game is served at https://<owner>.github.io/<repo>/.
//
// The hosted copy plays offline by default (the game's `?ws=off` mode): an https page cannot open a
// plain ws:// relay, and there is no relay next to the page anyway. `?ws=wss://…` still works.
// It is also installable: the build emits manifest.webmanifest, icons/ and a service worker (sw.js)
// that precaches the whole game, and all of it is copied here along with assets/.
// The owner's console (admin.html + admin/, from game/public) comes along too: it is filled in for the
// owner's relay here (see finishOwnerConsole) and the service worker never caches it.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const out = mkdtempSync(path.join(tmpdir(), 'squadhq-pages-'));

// The relay the hosted copy (and the app installed from it) connects to when the address names none and the
// player saved none: the owner's own relay, hosted as server/README.md "Host the relay online" describes.
// An empty string means "play offline unless a relay is given in the address or saved in FRIENDS".
const DEFAULT_RELAY = 'wss://gamerfleet-relay.onrender.com';

// The owner's console talks to the same relay's admin API over https: wss://host → https://host.
const CONSOLE_RELAY_ORIGIN = (() => {
  if (!DEFAULT_RELAY) return '';
  const url = new URL(DEFAULT_RELAY);
  const protocol = { 'wss:': 'https:', 'ws:': 'http:', 'https:': 'https:', 'http:': 'http:' }[url.protocol];
  if (!protocol) throw new Error(`DEFAULT_RELAY is not a relay address: ${DEFAULT_RELAY}`);
  return `${protocol}//${url.host}`;
})();

/**
 * The game's Google client id (public), so the console's SIGN IN WITH GOOGLE uses the same one. Read from a
 * literal `export const GOOGLE_CLIENT_ID = '…'` in game/src/config.ts or game/src/auth/; '' = not configured yet.
 */
function gameGoogleClientId() {
  const files = [path.join(root, 'game/src/config.ts')];
  const authDir = path.join(root, 'game/src/auth');
  if (existsSync(authDir)) for (const f of readdirSync(authDir)) if (/\.tsx?$/.test(f)) files.push(path.join(authDir, f));
  const found = new Set();
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(/export\s+const\s+GOOGLE_CLIENT_ID\s*(?::\s*string\s*)?=\s*(['"`])([^'"`\n]*)\1/g)) found.add(m[2].trim());
  }
  if (found.size > 1) throw new Error(`the game defines GOOGLE_CLIENT_ID more than once, differently: ${[...found].join(', ')}`);
  const id = [...found][0] ?? '';
  if (id && !/^[A-Za-z0-9._-]{1,200}$/.test(id)) throw new Error(`GOOGLE_CLIENT_ID does not look like a Google client id: ${id}`);
  return id;
}

/**
 * docs/admin.html and docs/admin/ (the owner's console, copied from game/public by the build):
 *   - admin/config.js gets the relay's https origin and the game's Google client id (public values only);
 *   - the page's Content-Security-Policy may connect to that relay and Google sign-in only (the source copy
 *     also allows a relay on this computer, for local testing);
 *   - its own files are loaded with a content hash in the URL, so a cached old file never meets a new page;
 *   - the service worker must neither precache it nor answer for it (it always comes from the network).
 */
function finishOwnerConsole() {
  const page = path.join(docs, 'admin.html');
  const own = ['admin/admin.css', 'admin/config.js', 'admin/admin.js'];
  for (const file of ['admin.html', ...own]) {
    if (!existsSync(path.join(docs, file))) throw new Error(`build output has no ${file} (game/public/${file})`);
  }
  const googleClientId = gameGoogleClientId();
  writeFileSync(
    path.join(docs, 'admin/config.js'),
    '/* Written by scripts/build-pages.mjs: public values only (never a key, a token or an email address). */\n' +
      `window.SQUADHQ_ADMIN_CONFIG = Object.freeze(${JSON.stringify({ relay: CONSOLE_RELAY_ORIGIN, googleClientId })});\n`,
  );
  const policy = [
    "default-src 'none'",
    "script-src 'self' https://accounts.google.com/gsi/client",
    "style-src 'self' https://accounts.google.com/gsi/style",
    "img-src 'self'",
    `connect-src ${[CONSOLE_RELAY_ORIGIN, 'https://accounts.google.com/gsi/'].filter(Boolean).join(' ')}`,
    'frame-src https://accounts.google.com/gsi/',
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
  let html = readFileSync(page, 'utf8');
  const policyMeta = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/;
  if (!policyMeta.test(html)) throw new Error('admin.html has no Content-Security-Policy meta to fill in');
  html = html.replace(policyMeta, (_, open, close) => `${open}${policy}${close}`);
  for (const file of own) {
    const hash = createHash('sha256').update(readFileSync(path.join(docs, file))).digest('hex').slice(0, 10);
    const ref = new RegExp(`((?:href|src)=")${file.replace(/[./]/g, '\\$&')}(")`);
    if (!ref.test(html)) throw new Error(`admin.html does not load ${file}`);
    html = html.replace(ref, (_, open, close) => `${open}${file}?v=${hash}${close}`);
  }
  writeFileSync(page, html);

  const sw = readFileSync(path.join(docs, 'sw.js'), 'utf8');
  const precache = JSON.parse(/const PRECACHE = (\[.*?\]);/s.exec(sw)?.[1] ?? 'null');
  if (!Array.isArray(precache) || !precache.includes('index.html')) throw new Error('sw.js has no precache list');
  if (precache.some((f) => f === 'admin.html' || f.startsWith('admin/'))) throw new Error('sw.js precaches the owner console');
  if (!sw.includes('ADMIN_PATH_RE.test(rel)')) throw new Error('sw.js does not leave the owner console to the network');
  console.log(
    `Owner console: docs/admin.html for ${CONSOLE_RELAY_ORIGIN || 'no relay (DEFAULT_RELAY is empty)'}; ` +
      `Google sign-in ${googleClientId ? 'on' : 'off (the game has no GOOGLE_CLIENT_ID yet)'}; not in the service worker's precache.`,
  );
}

const OFFLINE_BY_DEFAULT = `<script>
      // Hosted copy: connect to the saved or default relay unless the address names one (?ws=…); ?ws=off plays offline.
      (function () {
        try {
          if (/[?&]ws=/.test(location.search)) return;
          // Relay for this start: the address saved by ☰ MENU → FRIENDS → CONNECT or by a friend's room link
          // (gamerfleet.relay.v1; 'off' = the player chose offline there), else the site's default relay, else offline.
          var saved = null;
          try { saved = localStorage.getItem('gamerfleet.relay.v1'); } catch (e) { /* no storage */ }
          var url = new URL(location.href);
          url.searchParams.set('ws', saved || ${JSON.stringify(DEFAULT_RELAY)} || 'off');
          history.replaceState(null, '', url.toString());
        } catch (e) {
          /* no history access: the game shows OFFLINE MODE and keeps playing */
        }
      })();
    </script>`;

try {
  // Relative asset paths, so the site works under the /<repo>/ path GitHub Pages gives a project.
  execSync(`npm --prefix game run build -- --base=./ --outDir ${JSON.stringify(out)} --emptyOutDir`, { cwd: root, stdio: 'inherit' });

  let html = readFileSync(path.join(out, 'index.html'), 'utf8');
  if (!html.includes('<script type="module"')) throw new Error('unexpected index.html: no module script');
  html = html.replace('<script type="module"', `${OFFLINE_BY_DEFAULT}\n    <script type="module"`);

  // Everything the build emitted goes to docs/: assets/, sw.js (the service worker, whose precache
  // list names every one of these files), manifest.webmanifest, icons/, favicon.svg. Each entry the
  // new build has is replaced wholesale (no stale hashed assets or icons left behind); files the
  // build does not produce (the README pictures) stay.
  for (const entry of readdirSync(out)) rmSync(path.join(docs, entry), { recursive: true, force: true });
  cpSync(out, docs, { recursive: true });
  for (const required of ['sw.js', 'manifest.webmanifest', 'icons']) {
    if (!existsSync(path.join(docs, required))) throw new Error(`build output has no ${required}`);
  }
  writeFileSync(path.join(docs, 'index.html'), html);
  finishOwnerConsole();
  // Tell GitHub Pages to serve the files as they are (no Jekyll pass).
  writeFileSync(path.join(docs, '.nojekyll'), '');
  console.log('\nPages site written to docs/. Commit docs/ and push.');
} finally {
  rmSync(out, { recursive: true, force: true });
}
