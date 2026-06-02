// Proyección 3D común a los visores 3D (trayectorias, superficie de
// Riemann, etc.).  Cámara orbital expresada en coordenadas esféricas
// (θ, φ, d) mirando al origen del mundo, con Z = "arriba".  La
// proyección perspectiva está montada a mano sobre canvas 2D para
// evitar dependencias pesadas y mantener la estética uniforme.

export type Vec3 = [number, number, number];

export interface CamState {
  theta: number; // azimut (rad)
  phi: number;   // elevación (rad)
  d: number;     // distancia al origen
}

export const DEFAULT_CAM: CamState = {
  theta: -Math.PI / 4,
  phi: Math.PI / 6,
  d: 4.2,
};

// Clamp del ángulo de elevación para evitar voltear el cubo al
// pasar por encima del polo.
export const PHI_MIN = (-89 * Math.PI) / 180;
export const PHI_MAX = (89 * Math.PI) / 180;

export const FOV = (50 * Math.PI) / 180;

/**
 * Proyecta un punto del mundo al plano del canvas.  Devuelve también
 * la profundidad (positiva delante de la cámara) para descartar
 * puntos detrás del plano de cámara y, en su caso, ordenar por
 * profundidad.
 */
export function project(
  p: Vec3,
  cam: CamState,
  w: number,
  h: number,
): { sx: number; sy: number; depth: number } | null {
  const cosP = Math.cos(cam.phi);
  const sinP = Math.sin(cam.phi);
  const camPos: Vec3 = [
    cam.d * cosP * Math.sin(cam.theta),
    -cam.d * cosP * Math.cos(cam.theta),
    cam.d * sinP,
  ];
  // Base de cámara: forward (hacia el origen), right, up.
  const fx = -camPos[0] / cam.d;
  const fy = -camPos[1] / cam.d;
  const fz = -camPos[2] / cam.d;
  // right = forward × worldUp,  worldUp = (0, 0, 1)
  let rx = fy * 1 - fz * 0;
  let ry = fz * 0 - fx * 1;
  let rz = fx * 0 - fy * 0;
  let rn = Math.hypot(rx, ry, rz);
  if (rn < 1e-9) {
    rx = 1;
    ry = 0;
    rz = 0;
    rn = 1;
  }
  rx /= rn;
  ry /= rn;
  rz /= rn;
  // up = right × forward
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;

  const dx = p[0] - camPos[0];
  const dy = p[1] - camPos[1];
  const dz = p[2] - camPos[2];

  const xCam = dx * rx + dy * ry + dz * rz;
  const yCam = dx * ux + dy * uy + dz * uz;
  const zCam = dx * fx + dy * fy + dz * fz; // profundidad hacia el frente

  if (zCam <= 0.02) return null;

  const f = Math.min(w, h) / 2 / Math.tan(FOV / 2);
  const sx = (xCam / zCam) * f + w / 2;
  const sy = -(yCam / zCam) * f + h / 2;
  return { sx, sy, depth: zCam };
}
