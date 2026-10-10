// Todo lo relacionado con Three.js: carga de modelos, material con líneas de capa,
// animación de impresión y los visores (portada, catálogo, ficha y "tu modelo").
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildProcedural } from './models.js';

export const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE_POINTER = matchMedia('(pointer: coarse)').matches;
const ACCENT = 0xe3262f;
const NO_CLIP = 1e6;

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/* ---------- Base ---------- */

function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.localClippingEnabled = true;
  return renderer;
}

function createStudio(renderer) {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2a30, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 4);
  const rim = new THREE.DirectionalLight(0xff8a8a, 0.9);
  rim.position.set(-4, 2, -3);
  scene.add(key, rim);
  return scene;
}

function fitCanvas(renderer, camera, canvas) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

let shadowTexture;
function contactShadow(radius) {
  if (!shadowTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    shadowTexture = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

/* Material estándar + líneas horizontales que imitan las capas de una impresión real. */
export function makePrintMaterial(hex) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex), roughness: 0.5, metalness: 0.04, side: THREE.DoubleSide, envMapIntensity: 0.7,
  });
  const uniforms = { uLayerFreq: { value: 42 }, uLayerStrength: { value: 1 } };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying float vLayerY;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vLayerY = position.y;',
    );
    shader.fragmentShader = 'varying float vLayerY;\nuniform float uLayerFreq;\nuniform float uLayerStrength;\n' +
      shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  {
    float ly = vLayerY * uLayerFreq;
    float lw = fwidth(ly);
    float ridge = 1.0 - pow(abs(fract(ly) - 0.5) * 2.0, 2.0);
    float fade = 1.0 - smoothstep(0.3, 0.7, lw);
    diffuseColor.rgb *= mix(1.0, 0.78 + 0.22 * ridge, uLayerStrength * fade);
  }`);
  };
  return mat;
}

/* ---------- Carga de modelos ---------- */
// Un modelo cargado es { geometry, parts }: una sola geometría con un grupo por pieza, y por pieza
// { name, color, map, vertexColors }. color es el que trae el archivo ('#rrggbb') o null si no trae.

export const extOf = (name) => name.split('?')[0].split('.').pop().toLowerCase();
export const MODEL_EXTS = ['stl', 'obj', 'glb', '3mf'];
export const ORIGINAL = 'original';
const NEUTRAL = '#8d8f96';
const MAX_SPLIT_COLORS = 16;
const Z_UP = new THREE.Matrix4().makeRotationX(-Math.PI / 2); // STL y 3MF vienen con Z hacia arriba

const modelCache = new Map();
const localFiles = new Map();

/* Permite previsualizar archivos que el dueño aún no ha publicado. */
export function registerLocalFile(path, file) {
  localFiles.set(path, file);
  modelCache.delete(path);
}

/* Devuelve el modelo centrado y escalado para que su lado mayor mida 2 unidades. */
export function loadModel(src) {
  if (!modelCache.has(src)) {
    const promise = fetchModel(src).then((m) => (normalizeGeometry(m.geometry), m));
    promise.catch(() => modelCache.delete(src));
    modelCache.set(src, promise);
  }
  return modelCache.get(src);
}

async function fetchModel(src) {
  if (src.startsWith('procedural:')) return buildModel(proceduralPieces(src.slice('procedural:'.length)));
  if (localFiles.has(src)) return parseModelBuffer(await localFiles.get(src).arrayBuffer(), extOf(src));
  const res = await fetch(src);
  if (!res.ok) throw new Error(`No se pudo cargar ${src} (${res.status})`);
  return parseModelBuffer(await res.arrayBuffer(), extOf(src));
}

/* Convierte un archivo en un modelo en milímetros con Y hacia arriba. */
export async function parseModelBuffer(buffer, ext) {
  switch (ext) {
    case 'stl': {
      const g = new STLLoader().parse(buffer);
      const vertexColors = !!g.hasColors;
      return buildModel(splitPieces([{
        geometry: subGeometry(g, { matrix: Z_UP, color: vertexColors }), key: 'stl', name: '', color: null, vertexColors,
      }]));
    }
    case 'obj':
      // Sin el .mtl no hay colores, pero los nombres de material sirven para separar piezas.
      return buildModel(splitPieces(objectPieces(new OBJLoader().parse(new TextDecoder().decode(buffer)), false)));
    case 'glb': {
      const gltf = await new GLTFLoader().parseAsync(buffer, '');
      return buildModel(splitPieces(objectPieces(gltf.scene, true)));
    }
    case '3mf': {
      const { parse3MF } = await import('./model3mf.js');
      return buildModel(parse3MF(buffer).map((p) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
        geometry.applyMatrix4(Z_UP);
        return { geometry, key: p.key, name: p.name, color: p.color };
      }));
    }
    default:
      throw new Error(`Formato no soportado: .${ext}`);
  }
}

function proceduralPieces(name) {
  const built = buildProcedural(name);
  const list = built.isBufferGeometry ? [{ geometry: built }] : built.parts;
  return list.flatMap((p, i) => [].concat(p.geometry).map((g) => ({
    geometry: subGeometry(g), key: `p${i}`, name: p.name || '', color: p.color || null,
  })));
}

/* Copia (un tramo de) una geometría a una nueva sin índice, con atributos Float32 simples. */
function subGeometry(src, { start = 0, count = Infinity, matrix = null, uv = false, color = false } = {}) {
  const idx = src.index;
  const total = idx ? idx.count : src.attributes.position.count;
  const n = Math.max(0, Math.min(count, total - start));
  const getters = ['getX', 'getY', 'getZ', 'getW'];
  const copy = (attr, size) => {
    const out = new Float32Array(n * size);
    for (let i = 0; i < n; i++) {
      const v = idx ? idx.getX(start + i) : start + i;
      for (let k = 0; k < size; k++) out[i * size + k] = k < attr.itemSize ? attr[getters[k]](v) : 1;
    }
    return new THREE.BufferAttribute(out, size);
  };
  const g = new THREE.BufferGeometry();
  const a = src.attributes;
  g.setAttribute('position', copy(a.position, 3));
  if (a.normal) g.setAttribute('normal', copy(a.normal, 3));
  if (uv && a.uv) g.setAttribute('uv', copy(a.uv, 2));
  if (color && a.color) g.setAttribute('color', copy(a.color, 3));
  if (matrix) g.applyMatrix4(matrix);
  return g;
}

const GENERIC_NAME = /^(__default|default(material)?|material|mat|none|untitled|mesh|object|node)?[\s._#-]*\d*$/i;
const cleanName = (s) => {
  const t = String(s || '').trim();
  return GENERIC_NAME.test(t) ? '' : t.slice(0, 40);
};

/* Piezas de una escena de three.js (OBJ, GLB): una por malla y material. */
function objectPieces(root, colorsKnown) {
  root.updateMatrixWorld(true);
  const pieces = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes.position) return;
    const mats = [].concat(o.material);
    const ranges = Array.isArray(o.material) && o.geometry.groups.length
      ? o.geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
    for (const r of ranges) {
      const mat = mats[r.materialIndex] || mats[0];
      const map = mat?.map || null;
      const vertexColors = !!(mat?.vertexColors && o.geometry.attributes.color);
      const color = colorsKnown && mat?.color && mat.name !== THREE.Loader.DEFAULT_MATERIAL_NAME ? `#${mat.color.getHexString()}` : null;
      const name = cleanName(mat?.name) || cleanName(o.name) || cleanName(o.parent?.name);
      const geometry = subGeometry(o.geometry, { start: r.start, count: r.count, matrix: o.matrixWorld, uv: !!map, color: vertexColors });
      const key = map ? `m${mat.uuid}` : vertexColors ? `v${geometry.uuid}` : color ? `c${color}` : `n${cleanName(mat?.name) || o.uuid}`;
      pieces.push({ geometry, key, name, color, map, vertexColors, tint: mat?.color });
    }
  });
  return pieces;
}

/* Piezas con colores por vértice: si son pocos colores, se separan en piezas de un color. */
function splitPieces(pieces) {
  return pieces.flatMap((piece) => {
    if (!piece.vertexColors) return [piece];
    const g = piece.geometry, col = g.attributes.color.array, n = g.attributes.position.count;
    const tint = piece.tint || new THREE.Color(1, 1, 1);
    const buckets = new Map();
    for (let t = 0; t + 2 < n; t += 3) {
      const q = (k) => Math.round(((col[t * 3 + k] + col[t * 3 + 3 + k] + col[t * 3 + 6 + k]) / 3) * 255);
      const key = (q(0) << 16) | (q(1) << 8) | q(2);
      if (!buckets.has(key)) {
        if (buckets.size >= MAX_SPLIT_COLORS) return [piece]; // degradados o pintura detallada: se deja tal cual
        buckets.set(key, []);
      }
      buckets.get(key).push(t);
    }
    return [...buckets].map(([key, tris]) => {
      const c = new THREE.Color((key >> 16) / 255, ((key >> 8) & 255) / 255, (key & 255) / 255).multiply(tint);
      const hex = `#${c.getHexString()}`;
      const out = new THREE.BufferGeometry();
      for (const name of ['position', 'normal']) {
        const a = g.attributes[name];
        if (!a) continue;
        const arr = new Float32Array(tris.length * 9);
        tris.forEach((t, i) => arr.set(a.array.subarray(t * 3, t * 3 + 9), i * 9));
        out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
      }
      return { geometry: out, key: `c${hex}`, name: buckets.size === 1 ? piece.name : '', color: hex };
    });
  });
}

/* Une las piezas (las de igual clave forman una sola) en una geometría con un grupo por pieza. */
function buildModel(pieces) {
  const parts = [], lists = [], byKey = new Map();
  for (const p of pieces) {
    if (!p.geometry.attributes.position.count) continue;
    let i = byKey.get(p.key);
    if (i === undefined) {
      byKey.set(p.key, (i = parts.length));
      parts.push({ name: p.name || '', color: p.color || null, map: p.map || null, vertexColors: !!p.vertexColors });
      lists.push([]);
    } else if (!parts[i].name && p.name) {
      parts[i].name = p.name;
    }
    lists[i].push(p.geometry);
  }
  if (!parts.length) throw new Error('El archivo no contiene mallas 3D');

  const withUV = parts.some((p) => p.map), withColor = parts.some((p) => p.vertexColors);
  const total = lists.flat().reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  const uv = withUV ? new Float32Array(total * 2) : null;
  const col = withColor ? new Float32Array(total * 3).fill(1) : null;
  const geometry = new THREE.BufferGeometry();
  let offset = 0;
  lists.forEach((geos, i) => {
    const start = offset;
    for (const g of geos) {
      if (!g.attributes.normal) g.computeVertexNormals();
      pos.set(g.attributes.position.array, offset * 3);
      nor.set(g.attributes.normal.array, offset * 3);
      if (uv && g.attributes.uv) uv.set(g.attributes.uv.array, offset * 2);
      if (col && g.attributes.color) col.set(g.attributes.color.array, offset * 3);
      offset += g.attributes.position.count;
    }
    geometry.addGroup(start, offset - start, i);
  });
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const seen = new Map();
  parts.forEach((p, i) => {
    const base = p.name || `Pieza ${i + 1}`;
    const k = (seen.get(base) || 0) + 1;
    seen.set(base, k);
    p.name = k > 1 ? `${base} ${k}` : base;
  });
  return { geometry, parts };
}

/* ¿El archivo trae colores propios? */
export const hasOwnColors = (model) => model.parts.some((p) => p.color || p.map || p.vertexColors);

function normalizeGeometry(g) {
  g.computeBoundingBox();
  const size = g.boundingBox.getSize(new THREE.Vector3());
  const center = g.boundingBox.getCenter(new THREE.Vector3());
  g.translate(-center.x, -center.y, -center.z);
  const s = 2 / Math.max(size.x, size.y, size.z);
  g.scale(s, s, s);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/* ---------- Color de las piezas ----------
 * paint puede ser '#hex' (todo de un color), ['#hex', …] (un color por pieza)
 * u ORIGINAL (los colores, texturas y colores por vértice del archivo). */

function makeModelMesh(model, paint) {
  const mesh = new THREE.Mesh(model.geometry, model.parts.map(() => makePrintMaterial(NEUTRAL)));
  mesh.userData.parts = model.parts;
  paintMesh(mesh, paint);
  return mesh;
}

function paintMesh(mesh, paint) {
  const original = paint === ORIGINAL;
  mesh.material.forEach((m, i) => {
    const p = mesh.userData.parts[i];
    const hex = original ? p.color || NEUTRAL : Array.isArray(paint) ? paint[i] || p.color || NEUTRAL : paint || NEUTRAL;
    const map = original ? p.map : null;
    const vertexColors = original && p.vertexColors;
    if (m.map !== map || m.vertexColors !== vertexColors) {
      Object.assign(m, { map, vertexColors });
      m.needsUpdate = true;
    }
    m.color.set(hex);
  });
}

const disposeMesh = (mesh) => mesh?.material.forEach((m) => m.dispose());

/* Volumen (en unidades³ de la geometría) por suma de tetraedros con signo. */
export function meshVolume(geo) {
  const pos = geo.attributes.position, idx = geo.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = idx ? idx.count : pos.count;
  let v = 0;
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, idx ? idx.getX(i) : i);
    b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1);
    c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2);
    v += a.dot(b.cross(c)) / 6;
  }
  return Math.abs(v);
}

/* Medidas reales (mm) de un archivo, sin normalizar. */
export async function measureFile(file) {
  const model = await parseModelBuffer(await file.arrayBuffer(), extOf(file.name));
  const geo = model.geometry;
  geo.computeBoundingBox();
  const size = geo.boundingBox.getSize(new THREE.Vector3());
  return { model, size, volume: meshVolume(geo) };
}

/* ---------- Animación de impresión ---------- */

function makeNozzle() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.6, roughness: 0.35 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd4a537, metalness: 0.9, roughness: 0.25 });
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.2), metal);
  block.position.y = 0.2;
  const heatbreak = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 16), metal);
  heatbreak.position.y = 0.35;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 16), brass);
  tip.rotation.x = Math.PI;
  tip.position.y = 0.08;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 12), new THREE.MeshBasicMaterial({ color: ACCENT }));
  glow.position.y = 0.025;
  const light = new THREE.PointLight(ACCENT, 1.5, 1.2, 2);
  light.position.y = 0.05;
  g.add(block, heatbreak, tip, glow, light);
  return g;
}

class PrintAnimator {
  constructor(scene, duration) {
    this.duration = duration;
    this.plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), NO_CLIP);
    this.nozzle = makeNozzle();
    this.sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: ACCENT, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.sheet.rotation.x = -Math.PI / 2;
    scene.add(this.nozzle, this.sheet);
    this.active = false;
    this.progress = 1;
    this.onDone = null;
    this.finish();
  }

  attach(mesh) {
    this.mesh = mesh;
    for (const m of mesh.material) m.clippingPlanes = [this.plane];
    this.box = mesh.geometry.boundingBox.clone();
    const size = this.box.getSize(new THREE.Vector3());
    const side = Math.max(size.x, size.z) * 1.3;
    this.sheet.scale.set(side, side, 1);
    this.finish();
  }

  start() {
    if (!this.mesh) return;
    if (REDUCED_MOTION) return this.finish();
    this.t = 0;
    this.progress = 0;
    this.active = true;
    this.nozzle.visible = this.sheet.visible = true;
    this.update(0);
  }

  finish() {
    this.active = false;
    this.progress = 1;
    this.plane.constant = NO_CLIP;
    this.nozzle.visible = this.sheet.visible = false;
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const p = Math.min(this.t / this.duration, 1);
    this.progress = p;
    const { min, max } = this.box;
    const h = min.y + (max.y - min.y) * p;
    this.plane.constant = h;
    this.sheet.position.y = h;
    const tri = (v) => 1 - Math.abs((v % 2) - 1);
    this.nozzle.position.set(
      THREE.MathUtils.lerp(min.x, max.x, tri(this.t * 2.3)),
      h,
      THREE.MathUtils.lerp(min.z, max.z, tri(this.t * 0.9 + 0.5)),
    );
    if (p >= 1) {
      this.finish();
      this.onDone?.();
    }
  }
}

/* Solo anima cuando el elemento está en pantalla y la pestaña visible. */
function watchVisibility(el, cb) {
  const io = new IntersectionObserver(([e]) => cb(e.isIntersecting), { rootMargin: '100px' });
  io.observe(el);
}

/* ---------- Portada: el modelo se imprime solo ---------- */

export class HeroViewer {
  constructor(canvas, { onProgress, onModel } = {}) {
    this.canvas = canvas;
    this.onProgress = onProgress;
    this.onModel = onModel;
    this.renderer = createRenderer(canvas);
    this.scene = createStudio(this.renderer);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.camera.position.set(0, 1.0, 6.2);
    this.camera.lookAt(0, -0.1, 0);
    this.pivot = new THREE.Group();
    this.shadow = contactShadow(1.5);
    this.scene.add(this.pivot, this.shadow);
    this.animator = new PrintAnimator(this.scene, 7);
    this.animator.onDone = () => { this.holdUntil = this.time + 3.2; };
    // En pantallas táctiles no se agrega órbita para no bloquear el scroll.
    if (!COARSE_POINTER) {
      this.controls = new OrbitControls(this.camera, canvas);
      Object.assign(this.controls, {
        enableZoom: false, enablePan: false, enableDamping: true, minPolarAngle: 0.6, maxPolarAngle: 1.9,
      });
      this.controls.target.set(0, -0.1, 0);
    }
    this.items = [];
    this.index = -1;
    this.time = 0;
    this.holdUntil = Infinity;
    this.colorOverride = null;
    this.visible = true;
    new ResizeObserver(() => fitCanvas(this.renderer, this.camera, canvas)).observe(canvas);
    watchVisibility(canvas, (v) => { this.visible = v; });
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  setItems(items, colorFor) {
    this.items = items;
    this.colorFor = colorFor;
    this.index = -1;
    this.next();
  }

  next() {
    if (!this.items.length) return;
    this.index = (this.index + 1) % this.items.length;
    this.show(this.items[this.index]);
  }

  async show(item) {
    const token = (this.token = (this.token || 0) + 1);
    let model;
    try {
      model = await loadModel(item.model);
    } catch (err) {
      console.warn(err);
      if (this.items.length > 1) setTimeout(() => this.next(), 500);
      return;
    }
    if (token !== this.token) return;
    if (this.mesh) {
      this.pivot.remove(this.mesh);
      disposeMesh(this.mesh);
    }
    this.item = item;
    this.mesh = makeModelMesh(model, this.colorOverride || this.colorFor(item));
    this.pivot.add(this.mesh);
    this.shadow.position.y = model.geometry.boundingBox.min.y - 0.002;
    this.holdUntil = Infinity;
    this.animator.attach(this.mesh);
    this.animator.start();
    if (!this.animator.active) this.holdUntil = this.time + 6;
    this.onModel?.(item);
  }

  setColor(hex) {
    this.colorOverride = hex;
    if (this.mesh) paintMesh(this.mesh, hex);
  }

  replay() {
    this.holdUntil = Infinity;
    this.animator.start();
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this.visible || document.hidden) return;
    this.time += dt;
    if (!REDUCED_MOTION) this.pivot.rotation.y += dt * 0.45;
    this.animator.update(dt);
    if (this.item) this.onProgress?.(this.animator.progress, this.item);
    if (this.time > this.holdUntil) this.items.length > 1 ? this.next() : this.replay();
    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  }
}

/* ---------- Catálogo: un solo canvas para todas las tarjetas ---------- */

export class GridRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = createRenderer(canvas);
    this.scene = createStudio(this.renderer);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, 0.9, 5.6);
    this.camera.lookAt(0, 0, 0);
    this.cards = new Set();
    this.clock = new THREE.Clock();
    this.active = false;
    this.paused = false;
    this.renderer.setAnimationLoop(() => this.tick());
  }

  add(el, src, paint) {
    const card = {
      el, mesh: null, paint,
      rot: Math.random() * Math.PI * 2, tiltX: 0, tiltY: 0, tx: 0, ty: 0, hover: false, scale: 1,
    };
    card.onMove = (e) => {
      const r = el.getBoundingClientRect();
      card.hover = true;
      card.tx = ((e.clientY - r.top) / r.height - 0.5) * 0.5;
      card.ty = ((e.clientX - r.left) / r.width - 0.5) * 0.9;
    };
    card.onLeave = () => { card.hover = false; card.tx = card.ty = 0; };
    el.addEventListener('pointermove', card.onMove);
    el.addEventListener('pointerleave', card.onLeave);
    loadModel(src)
      .then((model) => {
        if (!this.cards.has(card)) return;
        card.mesh = makeModelMesh(model, card.paint);
        el.classList.add('is-loaded');
      })
      .catch((err) => {
        console.warn(err);
        el.classList.add('is-error');
      });
    this.cards.add(card);
    return card;
  }

  remove(card) {
    card.el.removeEventListener('pointermove', card.onMove);
    card.el.removeEventListener('pointerleave', card.onLeave);
    disposeMesh(card.mesh);
    this.cards.delete(card);
  }

  clear() {
    for (const card of [...this.cards]) this.remove(card);
  }

  setPaint(card, paint) {
    card.paint = paint;
    if (card.mesh) paintMesh(card.mesh, paint);
  }

  setActive(v) { this.active = v; }
  setPaused(v) { this.paused = v; }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const r = this.renderer;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const pr = r.getPixelRatio();
    if (this.canvas.width !== Math.floor(W * pr) || this.canvas.height !== Math.floor(H * pr)) r.setSize(W, H, false);
    r.setScissorTest(false);
    r.clear();
    if (!this.active || this.paused || document.hidden) return;
    r.setScissorTest(true);
    const k = 1 - Math.exp(-dt * 8);
    for (const card of this.cards) {
      if (!card.mesh) continue;
      const rect = card.el.getBoundingClientRect();
      if (!rect.width || rect.bottom < 0 || rect.top > H || rect.right < 0 || rect.left > W) continue;
      card.tiltX += (card.tx - card.tiltX) * k;
      card.tiltY += (card.ty - card.tiltY) * k;
      card.scale += ((card.hover ? 1.07 : 1) - card.scale) * k;
      if (!REDUCED_MOTION) card.rot += dt * (card.hover ? 1.3 : 0.35);
      card.mesh.rotation.set(card.tiltX, card.rot + card.tiltY, 0);
      card.mesh.scale.setScalar(card.scale);
      const bottom = H - rect.bottom;
      r.setViewport(rect.left, bottom, rect.width, rect.height);
      r.setScissor(rect.left, bottom, rect.width, rect.height);
      this.camera.aspect = rect.width / rect.height;
      this.camera.updateProjectionMatrix();
      this.scene.add(card.mesh);
      r.render(this.scene, this.camera);
      this.scene.remove(card.mesh);
    }
  }
}

/* ---------- Ficha del modelo: órbita, zoom, malla, impresión ---------- */

export class ModalViewer {
  constructor(canvas, { printDuration = 4.5 } = {}) {
    this.canvas = canvas;
    this.renderer = createRenderer(canvas);
    this.scene = createStudio(this.renderer);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true, enablePan: false, minDistance: 2.5, maxDistance: 9,
      autoRotate: !REDUCED_MOTION, autoRotateSpeed: 2,
    });
    this.shadow = contactShadow(1.5);
    this.scene.add(this.shadow);
    this.animator = new PrintAnimator(this.scene, printDuration);
    this.wire = false;
    this.clock = new THREE.Clock();
    new ResizeObserver(() => fitCanvas(this.renderer, this.camera, canvas)).observe(canvas);
  }

  async show(src, paint, { print = true } = {}) {
    const token = (this.token = (this.token || 0) + 1);
    const model = await loadModel(src);
    if (token !== this.token) return model;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      disposeMesh(this.mesh);
    }
    this.mesh = makeModelMesh(model, paint);
    for (const m of this.mesh.material) m.wireframe = this.wire;
    this.scene.add(this.mesh);
    this.shadow.position.y = model.geometry.boundingBox.min.y - 0.002;
    this.camera.position.set(0, 0.8, 5.2);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.animator.attach(this.mesh);
    if (print) this.animator.start();
    return model;
  }

  setPaint(paint) { if (this.mesh) paintMesh(this.mesh, paint); }
  replay() { this.animator.start(); }

  toggleWire() {
    this.wire = !this.wire;
    for (const m of this.mesh?.material || []) m.wireframe = this.wire;
    return this.wire;
  }

  toggleRotate() {
    this.controls.autoRotate = !this.controls.autoRotate;
    return this.controls.autoRotate;
  }

  start() {
    this.clock.getDelta();
    fitCanvas(this.renderer, this.camera, this.canvas);
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.animator.update(dt);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  stop() {
    this.renderer.setAnimationLoop(null);
  }

  dispose() {
    this.stop();
    this.controls.dispose();
    disposeMesh(this.mesh);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

/* ---------- "Imprime tu modelo": vista sobre la cama de impresión ---------- */

const MM = 0.01; // 1 mm = 0.01 unidades de escena

export class UploadViewer {
  constructor(canvas, printer) {
    this.canvas = canvas;
    this.renderer = createRenderer(canvas);
    this.scene = createStudio(this.renderer);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, enablePan: false });
    this.bedGroup = new THREE.Group();
    this.scene.add(this.bedGroup);
    this.setPrinter(printer);
    this.scale = 1;
    this.clock = new THREE.Clock();
    new ResizeObserver(() => fitCanvas(this.renderer, this.camera, canvas)).observe(canvas);
    watchVisibility(canvas, (v) => { this.visible = v; });
    this.renderer.setAnimationLoop(() => {
      if (!this.visible || document.hidden) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  setPrinter(printer) {
    this.printer = printer;
    this.bedGroup.clear();
    const bx = printer.x * MM, bd = printer.y * MM, bh = printer.z * MM;
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(bx, bd),
      new THREE.MeshStandardMaterial({ color: 0x2a2b30, roughness: 0.8, metalness: 0.1 }),
    );
    plate.rotation.x = -Math.PI / 2;
    const max = Math.max(bx, bd);
    const grid = new THREE.GridHelper(max, Math.round(Math.max(printer.x, printer.y) / 10), 0x5a5a62, 0x3a3a40);
    grid.scale.set(bx / max, 1, bd / max);
    grid.position.y = 0.001;
    const volume = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(bx, bh, bd)),
      new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.35 }),
    );
    volume.position.y = bh / 2;
    this.bedGroup.add(plate, grid, volume);
  }

  async load(file, paint) {
    const { model, size, volume } = await measureFile(file);
    const geo = model.geometry;
    const box = geo.boundingBox;
    const c = box.getCenter(new THREE.Vector3());
    geo.translate(-c.x, -box.min.y, -c.z);
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      disposeMesh(this.mesh);
    }
    this.mesh = makeModelMesh(model, paint);
    for (const m of this.mesh.material) m.userData.uniforms.uLayerFreq.value = 1; // una línea por mm
    this.scene.add(this.mesh);
    this.size = size;
    this.setScale(this.scale);
    this.frame();
    return { size, volume, ownColors: hasOwnColors(model) };
  }

  setScale(s) {
    this.scale = s;
    this.mesh?.scale.setScalar(s * MM);
  }

  setPaint(paint) { if (this.mesh) paintMesh(this.mesh, paint); }

  fits(s = this.scale) {
    if (!this.size) return true;
    const m = [this.size.x, this.size.y, this.size.z].map((v) => v * s).sort((a, b) => a - b);
    const p = [this.printer.x, this.printer.y, this.printer.z].sort((a, b) => a - b);
    return m.every((v, i) => v <= p[i]);
  }

  frame() {
    const p = this.printer;
    const w = Math.max(p.x, this.size.x * this.scale) * MM;
    const h = Math.max(p.z, this.size.y * this.scale) * MM;
    const d = Math.max(p.y, this.size.z * this.scale) * MM;
    const radius = 0.5 * Math.hypot(w, h, d);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.95;
    this.controls.target.set(0, h * 0.35, 0);
    this.camera.position.set(dist * 0.55, h * 0.35 + dist * 0.45, dist * 0.7);
    this.controls.minDistance = radius * 0.3;
    this.controls.maxDistance = dist * 2;
    this.controls.update();
  }
}
