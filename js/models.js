// Modelos de demostración generados por código.
// En data/site.json se usan como  "model": "procedural:<nombre>".
// El dueño puede reemplazarlos por archivos reales (STL/OBJ/GLB) desde el panel.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;

const builders = {
  twistVase,
  facetedPot,
  gear,
  knot,
  phoneStand,
  heartKeychain,
  hexOrganizer,
  d20,
};

export function buildProcedural(name) {
  const build = builders[name];
  if (!build) throw new Error(`Modelo procedural desconocido: ${name}`);
  return build();
}

/* Jarrón con ondas que giran al subir (clásico "vase mode"). */
function twistVase() {
  const seg = 128, rings = 96, H = 2.2, lobes = 7;
  const pos = [], idx = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const r = 0.42 + 0.3 * Math.sin(Math.PI * (0.15 + t * 0.85)) + 0.1 * t * t;
    const twist = t * 1.4;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * TAU;
      const rr = r * (1 + 0.1 * Math.cos(lobes * (a - twist)));
      pos.push(Math.cos(a) * rr, t * H, Math.sin(a) * rr);
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg);
      const c = a + seg, d = b + seg;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Base con vértices propios para que no suavice el borde inferior.
  const base = pos.length / 3;
  for (let j = 0; j < seg; j++) pos.push(pos[j * 3], 0, pos[j * 3 + 2]);
  const center = pos.length / 3;
  pos.push(0, 0, 0);
  for (let j = 0; j < seg; j++) idx.push(center, base + ((j + 1) % seg), base + j);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* Maceta low-poly de 7 caras. */
function facetedPot() {
  const pts = [
    [0, 0], [0.6, 0], [0.66, 0.05], [0.98, 1.25], [0.98, 1.33],
    [0.9, 1.33], [0.62, 0.16], [0, 0.16],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 7).toNonIndexed();
  g.computeVertexNormals();
  return g;
}

/* Engranaje con agujeros de aligeramiento. */
function gear() {
  const teeth = 14, rOut = 1, rRoot = 0.84, step = TAU / teeth;
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    const pts = [[rRoot, a0], [rOut, a0 + step * 0.18], [rOut, a0 + step * 0.45], [rRoot, a0 + step * 0.63]];
    pts.forEach(([r, a], k) => {
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0 && k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  const axle = new THREE.Path();
  axle.absarc(0, 0, 0.22, 0, TAU, true);
  shape.holes.push(axle);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU;
    const hole = new THREE.Path();
    hole.absarc(Math.cos(a) * 0.53, Math.sin(a) * 0.53, 0.15, 0, TAU, true);
    shape.holes.push(hole);
  }
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.32, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 2, curveSegments: 24,
  });
}

function knot() {
  return new THREE.TorusKnotGeometry(0.75, 0.24, 240, 32, 2, 3);
}

/* Soporte para celular visto de perfil y extruido a lo ancho. */
function phoneStand() {
  const s = new THREE.Shape();
  [[-0.75, 0], [0.75, 0], [0.75, 0.32], [0.63, 0.32], [0.63, 0.14], [0.35, 0.14],
    [-0.3, 1.35], [-0.46, 1.27], [0.12, 0.14], [-0.75, 0.14]]
    .forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return new THREE.ExtrudeGeometry(s, {
    depth: 1.1, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2,
  });
}

/* Llavero con forma de corazón (forma del ejemplo oficial de three.js). */
function heartKeychain() {
  const s = new THREE.Shape();
  s.moveTo(5, 5);
  s.bezierCurveTo(5, 5, 4, 0, 0, 0);
  s.bezierCurveTo(-6, 0, -6, 7, -6, 7);
  s.bezierCurveTo(-6, 11, -3, 15.4, 5, 19);
  s.bezierCurveTo(12, 15.4, 16, 11, 16, 7);
  s.bezierCurveTo(16, 7, 16, 0, 10, 0);
  s.bezierCurveTo(7, 0, 5, 5, 5, 5);
  const hole = new THREE.Path();
  hole.absarc(-1.5, 4.5, 1.3, 0, TAU, true);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 3, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.6, bevelSegments: 3, curveSegments: 32,
  });
  g.rotateZ(Math.PI);
  return g;
}

/* Organizador de escritorio tipo panal. */
function hexOrganizer() {
  const R = 0.5, wall = 0.07;
  const hex = (r) => {
    const sh = new THREE.Shape();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k / 6) * TAU;
      k ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    sh.closePath();
    return sh;
  };
  const tubeShape = hex(R);
  const inner = hex(R - wall);
  tubeShape.holes.push(new THREE.Path(inner.getPoints()));
  const cells = [[0, 0, 1.5]];
  const heights = [1.0, 1.2, 0.8, 1.15, 0.9, 1.25];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU, d = Math.sqrt(3) * R;
    cells.push([Math.cos(a) * d, Math.sin(a) * d, heights[k]]);
  }
  const parts = [];
  for (const [x, y, h] of cells) {
    const tube = new THREE.ExtrudeGeometry(tubeShape, { depth: h, bevelEnabled: false });
    const floor = new THREE.ExtrudeGeometry(hex(R), { depth: 0.06, bevelEnabled: false });
    for (const g of [tube, floor]) {
      g.translate(x, y, 0);
      parts.push(g);
    }
  }
  const g = mergeGeometries(parts);
  g.rotateX(-Math.PI / 2);
  return g;
}

function d20() {
  return new THREE.IcosahedronGeometry(1, 0);
}
