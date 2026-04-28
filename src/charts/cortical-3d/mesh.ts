/**
 * Procedural brain-like mesh + vector projection.
 *
 * The whitepaper specifies a 3.5D cortical projection. Real MNI152
 * meshes are large and not bundled with the studio; instead we build a
 * synthetic brain shape that conveys the visual idiom (two hemispheres
 * separated by a sulcus, gyri-like surface variation) and project it to
 * SVG triangles using painter's algorithm. This keeps the figure fully
 * vector-exportable.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Triangle {
  a: number;
  b: number;
  c: number;
}

export interface Mesh {
  vertices: Vec3[];
  triangles: Triangle[];
}

/**
 * Sample a brain-like surface as a deformed ellipsoid in spherical
 * coordinates. The longitudinal sulcus is created by pushing both
 * hemispheres slightly inward at theta = 0 / pi.
 */
export function buildBrainMesh(uSteps = 40, vSteps = 24): Mesh {
  const vertices: Vec3[] = [];
  for (let i = 0; i <= vSteps; i++) {
    const phi = (i / vSteps) * Math.PI;
    for (let j = 0; j < uSteps; j++) {
      const theta = (j / uSteps) * 2 * Math.PI;
      // Base ellipsoid radii (right-left, sup-inf, ant-post).
      const rx = 1.05;
      const ry = 0.85;
      const rz = 1.25;
      let x = rx * Math.sin(phi) * Math.cos(theta);
      const y = ry * Math.cos(phi);
      const z = rz * Math.sin(phi) * Math.sin(theta);
      // Inter-hemispheric sulcus (push x toward 0 near theta = pi/2 and 3pi/2).
      const sulcus =
        Math.exp(-Math.pow(Math.cos(theta), 2) * 22) * Math.sin(phi) * 0.13;
      x = x * (1 - sulcus);
      // Frontal/temporal lobe bumps (gyri-like surface ripple).
      const ripple =
        Math.sin(theta * 6) * 0.045 +
        Math.cos(phi * 8 + theta * 3) * 0.03;
      const r = 1 + ripple;
      vertices.push({ x: x * r, y: y * r, z: z * r });
    }
  }

  const triangles: Triangle[] = [];
  const idx = (i: number, j: number) => i * uSteps + ((j + uSteps) % uSteps);
  for (let i = 0; i < vSteps; i++) {
    for (let j = 0; j < uSteps; j++) {
      const a = idx(i, j);
      const b = idx(i + 1, j);
      const c = idx(i + 1, j + 1);
      const d = idx(i, j + 1);
      triangles.push({ a, b: b, c });
      triangles.push({ a, b: c, c: d });
    }
  }
  return { vertices, triangles };
}

export interface Rotation {
  yaw: number;
  pitch: number;
}

export function rotate(v: Vec3, rot: Rotation): Vec3 {
  const cy = Math.cos(rot.yaw);
  const sy = Math.sin(rot.yaw);
  const cp = Math.cos(rot.pitch);
  const sp = Math.sin(rot.pitch);
  // Yaw around Y, then pitch around X.
  const x = cy * v.x + sy * v.z;
  let z = -sy * v.x + cy * v.z;
  const y = cp * v.y - sp * z;
  z = sp * v.y + cp * z;
  return { x, y, z };
}

/**
 * Build a Gaussian activation scalar field over the mesh: place k
 * "hotspots" at fixed unit-sphere locations so the figure is
 * deterministic across renders.
 */
export interface Hotspot {
  cx: number;
  cy: number;
  cz: number;
  amp: number;
  sigma: number;
}

export const DEFAULT_HOTSPOTS: Hotspot[] = [
  { cx: -0.7, cy: 0.0, cz: 0.6, amp: 1.0, sigma: 0.45 },
  { cx: 0.5, cy: 0.4, cz: -0.6, amp: 0.7, sigma: 0.6 },
  { cx: 0.0, cy: -0.5, cz: -0.9, amp: 0.45, sigma: 0.55 },
];

export function activationAt(v: Vec3, spots: Hotspot[]): number {
  let s = 0;
  for (const h of spots) {
    const d2 = (v.x - h.cx) ** 2 + (v.y - h.cy) ** 2 + (v.z - h.cz) ** 2;
    s += h.amp * Math.exp(-d2 / (2 * h.sigma * h.sigma));
  }
  return s;
}
