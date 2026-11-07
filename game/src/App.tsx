import { Suspense, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { GRAVITY } from '@shared/protocol';
import { DirectionalLight } from 'three';
import { GameAudio } from './audio/GameAudio';
import { ChaseCamera } from './camera/ChaseCamera';
import { Car } from './car/Car';
import { installKeyboardInput, isTouchDevice } from './car/input';
import { PHYSICS_DT, isPhysicsDebug } from './config';
import { RacerDebugHandle } from './debug/racerHandle';
import { useGlobalHotkeys } from './game/hotkeys';
import { RunController } from './game/RunController';
import { RivalsLayer } from './rivals/RivalsLayer';
import { HUD } from './hud/HUD';
import RemotePlayersLayer from './multiplayer/RemotePlayersLayer';
import { useSquadLink } from './net/squadLink';
import { Environment } from './scene/Environment';
import { useSelection } from './state/selection';
import { useGameStore } from './state/store';
import { Track } from './track/Track';

/** Phones and tablets: high-DPI screens with mobile GPUs. Desktop rendering is untouched. */
const TOUCH_DEVICE = isTouchDevice();
const DPR: [number, number] = TOUCH_DEVICE ? [1, 1.5] : [1, 2];
/** Sun shadow map edge on touch devices (the scene's own setting, 1024, elsewhere). */
const TOUCH_SHADOW_MAP_SIZE = 512;

/**
 * Touch devices only: shrink the shadow maps of the shadow-casting directional lights (the sun in
 * scene/Environment.tsx). Mounted inside the same Suspense boundary, so the lights exist by this
 * layout effect, which runs before the first frame allocates the maps.
 */
function TouchShadowBudget() {
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => {
    scene.traverse((obj) => {
      if (!(obj instanceof DirectionalLight) || !obj.castShadow || obj.shadow.mapSize.x <= TOUCH_SHADOW_MAP_SIZE) return;
      obj.shadow.mapSize.set(TOUCH_SHADOW_MAP_SIZE, TOUCH_SHADOW_MAP_SIZE);
      obj.shadow.map?.dispose();
      obj.shadow.map = null;
    });
  }, [scene]);
  return null;
}

/** The car mounts once the track has registered its layout, keyed so a new track or car gets a fresh car. */
function PlayerCar() {
  const layout = useGameStore((s) => s.trackLayout);
  const carId = useSelection((s) => s.carId);
  return layout ? <Car key={`${layout.id}:${carId}`} spawn={layout.spawn} /> : null;
}

/**
 * The ☰ menu pauses the simulation: no physics steps, so the run clock, start lights, hazard clock,
 * pendulums and tiles all freeze and resume exactly where they were.
 *
 * Subscribed here, inside the R3F tree, rather than in App: a store change re-renders this R3F
 * component in a microtask (useSyncExternalStore is a sync update), whereas a prop handed down from
 * the DOM tree would reach the canvas through a scheduled render task. So when the page is hidden
 * mid-run (hud/autoPause.ts opens the menu) the pause is committed before the page can be frozen or
 * draw again, and the first frame back, which carries the whole hidden time as its delta, steps
 * nothing (instead of up to 0.5 s of catch-up).
 */
function PausablePhysics({ children }: { children: ReactNode }) {
  const paused = useSelection((s) => s.menuOpen);
  return (
    <Physics timeStep={PHYSICS_DT} gravity={[0, -GRAVITY, 0]} debug={isPhysicsDebug()} paused={paused}>
      {children}
    </Physics>
  );
}

export function App() {
  useSquadLink();
  useGlobalHotkeys();
  useEffect(() => installKeyboardInput(), []);

  return (
    <div className="app">
      <Canvas
        className="app__canvas"
        shadows="percentage"
        dpr={DPR}
        camera={{ fov: 62, near: 0.1, far: 3000, position: [0, 4, -9] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <Suspense fallback={null}>
          <Environment />
          <PausablePhysics>
            <Track />
            <PlayerCar />
            <RunController />
            <RivalsLayer />
            <RacerDebugHandle />
            <RemotePlayersLayer />
          </PausablePhysics>
          <ChaseCamera />
          {TOUCH_DEVICE && <TouchShadowBudget />}
        </Suspense>
      </Canvas>
      <HUD />
      <GameAudio />
    </div>
  );
}
