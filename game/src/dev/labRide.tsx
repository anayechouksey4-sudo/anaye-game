/** Dev page: game/lab-ride.html → the MY RIDE tab on its own (live preview, share codes, persistence). */
import { RideTab } from '../hud/RideTab';
import { LabShell, mountLab } from './labShell';

mountLab(
  <LabShell title="MY RIDE">
    <RideTab />
  </LabShell>,
);
