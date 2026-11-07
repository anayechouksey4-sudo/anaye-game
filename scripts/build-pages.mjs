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
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const out = mkdtempSync(path.join(tmpdir(), 'squadhq-pages-'));

const OFFLINE_BY_DEFAULT = `<script>
      // Hosted copy: play offline unless the address names a relay (?ws=…). ☰ MENU → PHYSICS tunes the car.
      (function () {
        try {
          if (/[?&]ws=/.test(location.search)) return;
          var url = new URL(location.href);
          url.searchParams.set('ws', 'off');
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
  // Tell GitHub Pages to serve the files as they are (no Jekyll pass).
  writeFileSync(path.join(docs, '.nojekyll'), '');
  console.log('\nPages site written to docs/. Commit docs/ and push.');
} finally {
  rmSync(out, { recursive: true, force: true });
}
