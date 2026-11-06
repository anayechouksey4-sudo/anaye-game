import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CAR_CLASS_IDS } from '../../shared/protocol';
import { CAR_ACCENTS, MAPS } from '../src/squad/garage';

/**
 * The dashboard can't import the game's catalogs (different bundler, React/zustand imports), so
 * src/squad/garage.ts keeps a copy of their display data. These tests read the game's files as
 * text and fail when the copy drifts (a new map, a renamed car, a changed lip speed).
 */
const here = dirname(fileURLToPath(import.meta.url));
const gameFile = (path: string) => resolve(here, '../../game/src', path);

/** Splits a catalog array into one text chunk per `id: '…'` entry (entries may contain nested braces). */
function entries(source: string, arrayName: string): Map<string, string> {
  const start = source.indexOf(`${arrayName}:`);
  assert.ok(start >= 0, `${arrayName} not found`);
  const body = source.slice(start, source.indexOf('\n];', start));
  const out = new Map<string, string>();
  const ids = [...body.matchAll(/\bid: '([^']+)'/g)];
  ids.forEach((match, i) => {
    const end = i + 1 < ids.length ? ids[i + 1]!.index : body.length;
    out.set(match[1]!, body.slice(match.index, end));
  });
  return out;
}

const field = (chunk: string, name: string) => chunk.match(new RegExp(`\\b${name}: '?([^',\\n]+)'?,`))?.[1];

/** `landKmhByCar: { rally: 184.5, muscle: 183 }` → { rally: 184.5, muscle: 183 }; undefined when absent. */
function numberRecord(chunk: string, name: string): Record<string, number> | undefined {
  const body = chunk.match(new RegExp(`\\b${name}: \\{([^}]*)\\}`))?.[1];
  if (body === undefined) return undefined;
  return Object.fromEntries([...body.matchAll(/(\w+): ([\d.]+)/g)].map((m) => [m[1]!, Number(m[2])]));
}

describe("garage copy matches the game's catalogs", () => {
  const trackPath = gameFile('track/catalog.ts');
  const carPath = gameFile('car/catalog.ts');

  it('maps: same ids in the same order, names, accents, big-jump lips, landing speeds and surface grip', { skip: !existsSync(trackPath) }, () => {
    const game = entries(readFileSync(trackPath, 'utf8'), 'TRACK_CATALOG');
    assert.deepEqual(MAPS.map((m) => m.id), [...game.keys()]);
    for (const map of MAPS) {
      const chunk = game.get(map.id)!;
      assert.equal(map.name, field(chunk, 'name'), `${map.id} name`);
      assert.equal(map.accent.toLowerCase(), field(chunk, 'accent')?.toLowerCase(), `${map.id} accent`);
      const hasJump = field(chunk, 'hasBigJump') === 'true';
      const lip = field(chunk, 'bigJumpKmh');
      assert.equal(map.bigJumpKmh, hasJump ? Number(lip) : null, `${map.id} big jump`);
      const land = field(chunk, 'landKmh');
      assert.equal(map.landKmh, land === undefined ? undefined : Number(land), `${map.id} landing lip speed`);
      assert.deepEqual(map.landKmhByCar === undefined ? undefined : { ...map.landKmhByCar }, numberRecord(chunk, 'landKmhByCar'), `${map.id} landing lip speed per car`);
      const grip = field(chunk, 'surfaceGrip');
      assert.equal(map.surfaceGrip, grip === undefined ? undefined : Number(grip), `${map.id} surface grip`);
    }
  });

  it('cars: every garage car has its accent here', { skip: !existsSync(carPath) }, () => {
    const game = entries(readFileSync(carPath, 'utf8'), 'CAR_CATALOG');
    assert.deepEqual([...game.keys()], [...CAR_CLASS_IDS]);
    for (const id of CAR_CLASS_IDS) {
      assert.equal(CAR_ACCENTS[id].toLowerCase(), field(game.get(id)!, 'accent')?.toLowerCase(), `${id} accent`);
    }
  });
});
