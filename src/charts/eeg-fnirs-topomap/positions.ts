/**
 * Standard 10-20 EEG sensor positions in 2D head-disc coordinates.
 *
 * The coordinates are the projection of the standard spherical head
 * model onto the unit disc using the azimuthal equidistant projection.
 * Values are taken from the canonical layout used by EEGLAB / FieldTrip
 * for the 10-20 system.
 */

export interface ElectrodePos {
  name: string;
  /** x in [-1, 1], left-right (negative = left). */
  x: number;
  /** y in [-1, 1], anterior-posterior (positive = front). */
  y: number;
}

export const EEG_10_20: ElectrodePos[] = [
  { name: 'Fp1', x: -0.31, y: 0.95 },
  { name: 'Fp2', x: 0.31, y: 0.95 },
  { name: 'F7', x: -0.81, y: 0.59 },
  { name: 'F3', x: -0.4, y: 0.5 },
  { name: 'Fz', x: 0.0, y: 0.5 },
  { name: 'F4', x: 0.4, y: 0.5 },
  { name: 'F8', x: 0.81, y: 0.59 },
  { name: 'T7', x: -1.0, y: 0.0 },
  { name: 'C3', x: -0.5, y: 0.0 },
  { name: 'Cz', x: 0.0, y: 0.0 },
  { name: 'C4', x: 0.5, y: 0.0 },
  { name: 'T8', x: 1.0, y: 0.0 },
  { name: 'P7', x: -0.81, y: -0.59 },
  { name: 'P3', x: -0.4, y: -0.5 },
  { name: 'Pz', x: 0.0, y: -0.5 },
  { name: 'P4', x: 0.4, y: -0.5 },
  { name: 'P8', x: 0.81, y: -0.59 },
  { name: 'O1', x: -0.31, y: -0.95 },
  { name: 'Oz', x: 0.0, y: -1.0 },
  { name: 'O2', x: 0.31, y: -0.95 },
];

export interface OptodePos {
  name: string;
  x: number;
  y: number;
  type: 'source' | 'detector';
}

export interface OptodePair {
  source: string;
  detector: string;
}

/**
 * A small synthetic fNIRS montage covering frontal, central, and
 * occipital regions. Sources (red) and detectors (blue) are placed
 * 1.5–3 cm apart on the unit disc.
 */
export const FNIRS_OPTODES: OptodePos[] = [
  { name: 'S1', x: -0.55, y: 0.78, type: 'source' },
  { name: 'D1', x: -0.32, y: 0.7, type: 'detector' },
  { name: 'S2', x: 0.0, y: 0.78, type: 'source' },
  { name: 'D2', x: 0.32, y: 0.7, type: 'detector' },
  { name: 'S3', x: 0.55, y: 0.78, type: 'source' },

  { name: 'S4', x: -0.6, y: 0.18, type: 'source' },
  { name: 'D3', x: -0.35, y: 0.1, type: 'detector' },
  { name: 'S5', x: 0.0, y: 0.18, type: 'source' },
  { name: 'D4', x: 0.35, y: 0.1, type: 'detector' },
  { name: 'S6', x: 0.6, y: 0.18, type: 'source' },

  { name: 'S7', x: -0.45, y: -0.65, type: 'source' },
  { name: 'D5', x: -0.18, y: -0.78, type: 'detector' },
  { name: 'S8', x: 0.0, y: -0.65, type: 'source' },
  { name: 'D6', x: 0.18, y: -0.78, type: 'detector' },
  { name: 'S9', x: 0.45, y: -0.65, type: 'source' },
];

export const FNIRS_PAIRS: OptodePair[] = [
  { source: 'S1', detector: 'D1' },
  { source: 'S2', detector: 'D1' },
  { source: 'S2', detector: 'D2' },
  { source: 'S3', detector: 'D2' },
  { source: 'S4', detector: 'D3' },
  { source: 'S5', detector: 'D3' },
  { source: 'S5', detector: 'D4' },
  { source: 'S6', detector: 'D4' },
  { source: 'S7', detector: 'D5' },
  { source: 'S8', detector: 'D5' },
  { source: 'S8', detector: 'D6' },
  { source: 'S9', detector: 'D6' },
];

export function getOptode(name: string): OptodePos | undefined {
  return FNIRS_OPTODES.find((o) => o.name === name);
}
