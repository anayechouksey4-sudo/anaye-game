/**
 * Draws the other players in the room: one rivals/KinematicCar per member (their car class, MY RIDE
 * look, plate and name in their colour), posed every frame from the interpolation buffer in
 * remotePlayers.ts. No physics bodies: cars pass through each other.
 *
 * Mount once inside the <Canvas> (App.tsx, next to the track / rivals layer). Renders nothing
 * outside a room. Name tags need rivals' <NameTags/> + <TagProjector/> mounted (builder-race).
 */
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { isCarClassId, type CarClassId, type RoomPlayer } from '@shared/protocol';
import KinematicCar from '../rivals/KinematicCar';
import { decodePlayer } from './identity';
import { INTERP_DELAY_MS, ensureRemote, forEachRemote, sampleRemote } from './remotePlayers';
import { relayNow } from './roomClient';
import { useRoom } from './roomStore';

function RemoteSampler() {
  useFrame((_, delta) => {
    const t = relayNow() - INTERP_DELAY_MS;
    const dt = Math.min(0.1, delta);
    const now = performance.now();
    // No per-frame array: the registry iterates its own map.
    forEachRemote((r) => sampleRemote(r, t, dt, now));
  });
  return null;
}

function RemoteCar({ player, index }: { player: RoomPlayer; index: number }) {
  const remote = useMemo(() => ensureRemote(player.id), [player.id]);
  const decoded = decodePlayer(player, index);
  const carId: CarClassId = isCarClassId(player.carId) ? player.carId : 'hypercar';
  return <KinematicCar carId={carId} look={decoded.look} plate={player.plate} label={player.name} labelColor={decoded.color} fade={remote.fade} pose={remote.pose} />;
}

export default function RemotePlayersLayer() {
  const status = useRoom((s) => s.status);
  const players = useRoom((s) => s.players);
  const you = useRoom((s) => s.you);
  if (status !== 'in-room') return null;
  return (
    <group name="remote-players">
      <RemoteSampler />
      {players.map((p, i) => (p.id === you ? null : <RemoteCar key={p.id} player={p} index={i} />))}
    </group>
  );
}
