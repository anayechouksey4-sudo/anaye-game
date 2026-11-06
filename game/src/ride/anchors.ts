/**
 * Where the driver sits in each car class, in the shape vocabulary (chassis x, GROUND-relative h,
 * chassis z; +X = the driver's left, so the driver sits at x > 0). `h` is the bust's origin (the
 * base of the neck): the torso hangs 0.22 m below it, the head rises 0.07–0.33 m above it.
 *
 * `open` cabins (the open-wheeler, the buggy) show the bust itself; closed cabins are solid voxel
 * bodies with opaque glass, so the livery paints a helmet-coloured "driver window" into the side
 * glass and windscreen beside this anchor instead (ride/livery.ts).
 */
export interface SeatAnchor {
  x: number;
  h: number;
  z: number;
  open: boolean;
}

const SEATS: Readonly<Record<string, SeatAnchor>> = {
  hypercar: { x: 0.4, h: 0.6, z: 0.2, open: false },
  rally: { x: 0.36, h: 0.9, z: 0.15, open: false },
  muscle: { x: 0.38, h: 0.86, z: 0.02, open: false },
  formula: { x: 0, h: 0.6, z: 0.32, open: true },
  buggy: { x: 0.28, h: 1.02, z: -0.2, open: true },
  coupe: { x: 0.38, h: 0.7, z: 0.1, open: false },
  // Smoke Lantern: cabin set far back, the raked screen is body-coloured skin, so the driver shows in
  // the door glass (z −1.3…0.05) with the eye line at the window's middle row.
  drift: { x: 0.38, h: 0.86, z: -0.5, open: false },
  // Ion Dragonfly: one long canopy; the seat sits mid-cabin so the window covers the door glass and
  // the driver's half of the glass screen.
  electric: { x: 0.38, h: 0.88, z: 0.1, open: false },
  // Pixel Gnat: open bucket seat on the centre line; the bust's head lands where the kart's painted
  // helmet used to be (centre h 0.68, z −0.22), its torso against the backrest (z −0.44…−0.34).
  kart: { x: 0, h: 0.48, z: -0.22, open: true },
};

const FALLBACK: SeatAnchor = { x: 0.36, h: 0.7, z: 0.1, open: false };

/** The seat anchor of a class (a class this file doesn't know gets a closed-cabin guess). */
export function seatFor(carId: string): SeatAnchor {
  return SEATS[carId] ?? FALLBACK;
}

/** True when the class has an authored anchor (else ride/livery.ts derives one from the body's glass). */
export function seatKnown(carId: string): boolean {
  return carId in SEATS;
}

/** Classes with a seat anchor of their own (tests iterate these). */
export const SEAT_CLASS_IDS: readonly string[] = Object.keys(SEATS);
