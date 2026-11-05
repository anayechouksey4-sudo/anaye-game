import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BIG_JUMP_LIP_KMH,
  assessBigJump,
  clampSquadControls,
  mapSquadControlsToPhysics,
} from '../../shared/protocol';
import { hapticForChange } from '../src/lib/hapticRules';
import { formatLapTime, formatSigned } from '../src/lib/format';
import { defaultServerUrl, hostFromHostUri, parseServerUrlInput } from '../src/net/serverUrl';
import { PRESETS } from '../src/squad/presets';
import { NOT_DRAGGING, mergeRemoteControls, resolveWelcomeSync } from '../src/squad/sync';

describe('presets', () => {
  it('are valid, distinct slider positions', () => {
    for (const preset of PRESETS) assert.deepEqual(clampSquadControls(preset.controls), preset.controls, preset.name);
    assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
  });

  it('JUMP ATTEMPT clears the big jump per assessBigJump', () => {
    const jump = PRESETS.find((p) => p.id === 'jump');
    assert.ok(jump);
    const verdict = assessBigJump(mapSquadControlsToPhysics(jump.controls));
    assert.equal(verdict.verdict, 'READY');
    assert.ok(verdict.topSpeedKmh >= BIG_JUMP_LIP_KMH);
  });

  it('TOP SPEED is the cautionary nose-lift setup and BALANCED is too slow', () => {
    const verdictOf = (id: string) => assessBigJump(mapSquadControlsToPhysics(PRESETS.find((p) => p.id === id)!.controls)).verdict;
    assert.equal(verdictOf('top-speed'), 'NOSE LIFT');
    assert.equal(verdictOf('balanced'), 'TOO SLOW');
  });
});

describe('welcome sync rule', () => {
  const snap = { frontWingAero: 77, engineTier: 4, chassisBalance: 12 };
  it('adopts the squad snapshot until the user touches something', () => {
    assert.equal(resolveWelcomeSync(snap, false), 'adopt');
    assert.equal(resolveWelcomeSync(snap, true), 'push');
    assert.equal(resolveWelcomeSync(null, false), 'push');
  });

  it('remote controls never move a slider the user is holding', () => {
    const local = { frontWingAero: 10, engineTier: 1, chassisBalance: -5 };
    assert.deepEqual(mergeRemoteControls(local, snap, NOT_DRAGGING), snap);
    assert.deepEqual(mergeRemoteControls(local, snap, { ...NOT_DRAGGING, engineTier: true }), {
      frontWingAero: 77,
      engineTier: 1,
      chassisBalance: 12,
    });
  });
});

describe('server URL', () => {
  it('derives the relay from the Metro host, the page host, or localhost', () => {
    assert.equal(defaultServerUrl({ hostUri: '192.168.1.23:8081' }), 'ws://192.168.1.23:8787');
    assert.equal(defaultServerUrl({ hostUri: null, webHostname: 'my-laptop.local' }), 'ws://my-laptop.local:8787');
    assert.equal(defaultServerUrl({}), 'ws://localhost:8787');
    assert.equal(hostFromHostUri('[fe80::1]:8081'), '[fe80::1]');
  });

  it('normalizes and validates typed addresses', () => {
    assert.deepEqual(parseServerUrlInput(' 10.0.0.5 '), { url: 'ws://10.0.0.5:8787' });
    assert.deepEqual(parseServerUrlInput('10.0.0.5:9000'), { url: 'ws://10.0.0.5:9000' });
    assert.deepEqual(parseServerUrlInput('wss://relay.example.com/'), { url: 'wss://relay.example.com' });
    assert.ok('error' in parseServerUrlInput(''));
    assert.ok('error' in parseServerUrlInput('my host'));
    assert.ok('error' in parseServerUrlInput('10.0.0.5:99999'));
  });
});

describe('haptics + formatting', () => {
  it('ticks every tier and every 10 units, bumps on the balance centre notch', () => {
    assert.equal(hapticForChange('engineTier', 2, 3), 'tick');
    assert.equal(hapticForChange('frontWingAero', 18, 19), null);
    assert.equal(hapticForChange('frontWingAero', 19, 20), 'tick');
    assert.equal(hapticForChange('chassisBalance', -11, -9), 'tick');
    assert.equal(hapticForChange('chassisBalance', 1, 0), 'notch');
    assert.equal(hapticForChange('chassisBalance', 4, 4), null);
  });

  it('formats lap times and signed forces', () => {
    assert.equal(formatLapTime(83_456), '1:23.456');
    assert.equal(formatLapTime(null), '--:--.---');
    assert.equal(formatSigned(1234.4), '+1,234');
    assert.equal(formatSigned(-567), '−567');
    assert.equal(formatSigned(0), '0');
  });
});
