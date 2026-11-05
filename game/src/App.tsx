import { Suspense, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { GRAVITY } from '@shared/protocol';
import { ChaseCamera } from './camera/ChaseCamera';
import { Car } from './car/Car';
import { installKeyboardInput } from './car/input';
import { PHYSICS_DT, isPhysicsDebug } from './config';
import { RacerDebugHandle } from './debug/racerHandle';
import { useGlobalHotkeys } from './game/hotkeys';
import { RunController } from './game/RunController';
import { HUD } from './hud/HUD';
import { useSquadLink } from './net/squadLink';
import { Environment } from './scene/Environment';
import { useGameStore } from './state/store';
import { Track } from './track/Track';

/** The car mounts once the track has registered its layout, keyed so a new track gets a fresh car. */
function PlayerCar() {
  const layout = useGameStore((s) => s.trackLayout);
  return layout ? <Car key={layout.id} spawn={layout.spawn} /> : null;
}

export function App() {
  useSquadLink();
  useGlobalHotkeys();
  useEffect(() => installKeyboardInput(), []);

  return (
    <div className="app">
      <Canvas
        className="app__canvas"
        shadows
        dpr={[1, 2]}
        camera={{ fov: 62, near: 0.1, far: 3000, position: [0, 4, -9] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <Suspense fallback={null}>
          <Environment />
          <Physics timeStep={PHYSICS_DT} gravity={[0, -GRAVITY, 0]} debug={isPhysicsDebug()}>
            <Track />
            <PlayerCar />
            <RunController />
            <RacerDebugHandle />
          </Physics>
          <ChaseCamera />
        </Suspense>
      </Canvas>
      <HUD />
    </div>
  );
}
