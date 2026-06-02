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
 * Proyecta un punto del mundo al plano del canvas para una cámara
 * con posición y target arbitrarios.  El descarte de puntos con
 * `zCam <= 0.02` actúa como near-plane y, al mismo tiempo, hace de
 * filtro de campo de visión: lo que queda detrás de la cámara (o
 * fuera del cono perspectivo, una vez proyectado, fuera del canvas)
 * se descarta automáticamente sin pintar.
 */
export function projectFromLookAt(
  p: Vec3,
  camPos: Vec3,
  target: Vec3,
  w: number,
  h: number,
): { sx: number; sy: number; depth: number } | null {
  // forward = (target - camPos), normalizado.
  let fx = target[0] - camPos[0];
  let fy = target[1] - camPos[1];
  let fz = target[2] - camPos[2];
  let fn = Math.hypot(fx, fy, fz);
  if (fn < 1e-9) {
    // Cámara superpuesta al target: orientación arbitraria
    // (mirar a +Y en mundo) para que la proyección no rompa.
    fx = 0;
    fy = 1;
    fz = 0;
    fn = 1;
  }
  fx /= fn;
  fy /= fn;
  fz /= fn;
  // right = forward × worldUp,  worldUp = (0, 0, 1)
  let rx = fy * 1 - fz * 0;
  let ry = fz * 0 - fx * 1;
  let rz = fx * 0 - fy * 0;
  let rn = Math.hypot(rx, ry, rz);
  if (rn < 1e-9) {
    // forward casi vertical: forzamos un "right" hacia +X.
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

/**
 * Variante para la cámara orbital: la posición se calcula desde las
 * esféricas (θ, φ, d) y el target es siempre el origen del mundo.
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
  return projectFromLookAt(p, camPos, [0, 0, 0], w, h);
}
