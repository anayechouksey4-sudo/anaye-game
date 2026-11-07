/**
 * One line for the results card while racing friends: "P1 OF 3 FRIENDS" (the position among the
 * room's finishers so far; "· SO FAR" until the host closes the race). Renders nothing outside a
 * shared race or before our own time is in. Mount inside Results.tsx under the medal / time block.
 */
import { positionOf, useRoom } from './roomStore';
import './friends.css';

export default function FriendsResultLine() {
  const status = useRoom((s) => s.status);
  const race = useRoom((s) => s.race);
  const you = useRoom((s) => s.you);
  if (status !== 'in-room' || !race || race.results.length < 2) return null;
  const position = positionOf(race, you);
  if (position === null) return null;
  const closed = race.phase === 'results';
  return (
    <div className="fr-resultline" data-testid="friends-result-line">
      P{position} OF {race.results.length} FRIENDS{closed ? '' : ' · SO FAR'}
    </div>
  );
}
