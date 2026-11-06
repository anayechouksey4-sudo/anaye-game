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
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  rmSync(path.join(docs, 'assets'), { recursive: true, force: true });
  cpSync(path.join(out, 'assets'), path.join(docs, 'assets'), { recursive: true });
  if (existsSync(path.join(out, 'favicon.svg'))) cpSync(path.join(out, 'favicon.svg'), path.join(docs, 'favicon.svg'));
  writeFileSync(path.join(docs, 'index.html'), html);
  // Tell GitHub Pages to serve the files as they are (no Jekyll pass).
  writeFileSync(path.join(docs, '.nojekyll'), '');
  console.log('\nPages site written to docs/. Commit docs/ and push.');
} finally {
  rmSync(out, { recursive: true, force: true });
}
