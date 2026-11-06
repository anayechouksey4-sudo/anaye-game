/** Dev page: game/lab-drivers.html → the DRIVERS tab on its own, plus a cockpit preview of the active driver. */
import { useState } from 'react';
import { getQueryParam } from '../config';
import { isCarClassIdSafe } from '../ride/config';
import type { CarClassId } from '@shared/protocol';
import { CAR_CATALOG } from '../car/catalog';
import { DriversTab, Seg } from '../hud/DriversTab';
import { RidePreview } from '../ride/RidePreview';
import { useActiveDriver } from '../state/profile';
import { LabShell, mountLab } from './labShell';

function CockpitPreview() {
  const driver = useActiveDriver();
  const first = getQueryParam('car');
  const [carId, setCarId] = useState<CarClassId>(isCarClassIdSafe(first) ? first : 'buggy');
  return (
    <div className="pf" style={{ marginTop: 12 }}>
      <h4 className="pf-section__title">IN THE COCKPIT · {driver.name.toUpperCase()}</h4>
      <Seg options={CAR_CATALOG.map((c) => c.id as CarClassId)} value={carId} onPick={setCarId} label={(id) => CAR_CATALOG.find((c) => c.id === id)?.name.toUpperCase() ?? id} testId="lab-car" />
      <RidePreview ride={null} carId={carId} driver={driver.avatar} />
    </div>
  );
}

mountLab(
  <LabShell title="DRIVERS">
    <DriversTab />
    <CockpitPreview />
  </LabShell>,
);
