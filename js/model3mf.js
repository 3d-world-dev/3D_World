// Lector de archivos 3MF (Bambu Studio, Orca, PrusaSlicer, Cura, Fusion…).
// Entiende objetos y componentes (también en archivos internos separados, como guarda Bambu),
// colores estándar (basematerials / colorgroup), el filamento asignado a cada pieza en el slicer
// y la pintura multicolor (paint_color / mmu_segmentation).
// Devuelve piezas: triángulos ya transformados, en mm y con Z hacia arriba, agrupados por color.
import * as THREE from 'three';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';

const UNITS = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

const all = (root, tag) => [...root.getElementsByTagNameNS('*', tag)];
const children = (el, tag) => [...el.children].filter((c) => c.localName === tag);

/* Atributo por nombre local, sin importar el prefijo de espacio de nombres (p:path, slic3rpe:…). */
function attr(el, name) {
  if (el.hasAttribute(name)) return el.getAttribute(name);
  for (const a of el.attributes) if (a.localName === name) return a.value;
  return null;
}

function parseTransform(s) {
  const m = new THREE.Matrix4();
  const v = String(s || '').trim().split(/\s+/).map(Number);
  if (v.length !== 12 || v.some((n) => !Number.isFinite(n))) return m;
  // 3MF usa vectores fila: p' = p · M. En three.js son columnas, de ahí el orden.
  return m.set(v[0], v[3], v[6], v[9], v[1], v[4], v[7], v[10], v[2], v[5], v[8], v[11], 0, 0, 0, 1);
}

const cleanHex = (s) => (/^#[0-9a-f]{6}/i.test(s || '') ? s.slice(0, 7).toLowerCase() : null);

/* Color predominante de un triángulo pintado (codificación TriangleSelector de PrusaSlicer/Bambu). */
function paintState(code) {
  const bits = [];
  for (let i = code.length - 1; i >= 0; i--) {
    const d = parseInt(code[i], 16);
    for (let b = 0; b < 4; b++) bits.push((d >> b) & 1);
  }
  let p = 0;
  const read = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) v |= (bits[p++] || 0) << i;
    return v;
  };
  const weights = new Map();
  const node = (w, depth) => {
    if (p >= bits.length || depth > 12) return;
    const split = read(2);
    if (split === 0) {
      let s = read(2);
      if (s === 3) s = read(4) + 3;
      weights.set(s, (weights.get(s) || 0) + w);
      return;
    }
    read(2); // lado especial de la subdivisión
    for (let i = 0; i <= split; i++) node(w / (split + 1), depth + 1);
  };
  node(1, 0);
  let best = 0, bestW = -1;
  for (const [s, w] of weights) if (w > bestW) { best = s; bestW = w; }
  return best;
}

/* Configuración del slicer: filamento de cada objeto/pieza y colores de los filamentos. */
function readSlicer(text) {
  const out = { found: false, colors: [], object: new Map(), part: new Map(), volumes: new Map() };
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const meta = (el, key) => {
    const m = children(el, 'metadata').find((x) => attr(x, 'key') === key);
    return m ? attr(m, 'value') : null;
  };

  const bambu = text('Metadata/model_settings.config');
  if (bambu) {
    out.found = true;
    for (const obj of all(xml(bambu), 'object')) {
      const id = attr(obj, 'id');
      out.object.set(id, { extruder: Number(meta(obj, 'extruder')) || 0, name: meta(obj, 'name') });
      for (const part of children(obj, 'part')) {
        out.part.set(`${id}/${attr(part, 'id')}`, { extruder: Number(meta(part, 'extruder')) || 0, name: meta(part, 'name') });
      }
    }
  }
  const prusa = text('Metadata/Slic3r_PE_model.config');
  if (prusa) {
    out.found = true;
    for (const obj of all(xml(prusa), 'object')) {
      const id = attr(obj, 'id');
      out.object.set(id, { extruder: Number(meta(obj, 'extruder')) || 0, name: meta(obj, 'name') });
      out.volumes.set(id, children(obj, 'volume').map((v) => ({
        first: Number(attr(v, 'firstid')), last: Number(attr(v, 'lastid')),
        extruder: Number(meta(v, 'extruder')) || 0, name: meta(v, 'name'),
      })));
    }
  }

  const project = text('Metadata/project_settings.config');
  if (project) {
    try { out.colors = (JSON.parse(project).filament_colour || []).map(cleanHex); } catch { /* sin colores */ }
  }
  const ini = text('Metadata/Slic3r_PE.config');
  if (ini && !out.colors.length) {
    const list = (key) => {
      const m = ini.match(new RegExp(`^;?\\s*${key}\\s*=\\s*(.*)$`, 'm'));
      return m ? m[1].split(';').map((s) => cleanHex(s.replace(/"/g, '').trim())) : [];
    };
    const ext = list('extruder_colour'), fil = list('filament_colour');
    out.colors = Array.from({ length: Math.max(ext.length, fil.length) }, (_, i) => ext[i] || fil[i] || null);
  }
  return out;
}

export function parse3MF(buffer) {
  const zip = unzipSync(new Uint8Array(buffer));
  const files = new Map(Object.entries(zip).map(([k, v]) => [k.replace(/^\/+/, '').toLowerCase(), v]));
  const text = (path) => {
    const f = files.get(String(path).replace(/^\/+/, '').toLowerCase());
    return f ? strFromU8(f) : null;
  };
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');

  let rootPath = null;
  const rels = text('_rels/.rels');
  if (rels) {
    const rel = all(xml(rels), 'Relationship').find((r) => /3dmodel$/i.test(attr(r, 'Type') || ''));
    rootPath = rel && attr(rel, 'Target');
  }
  rootPath = (rootPath || [...files.keys()].find((k) => k.endsWith('.model')) || '').replace(/^\/+/, '');
  if (!text(rootPath)) throw new Error('El 3MF no contiene un modelo');

  const models = new Map();
  const model = (path) => {
    const key = path.replace(/^\/+/, '').toLowerCase();
    if (!models.has(key)) {
      const src = text(key);
      if (!src) throw new Error(`Falta ${path} dentro del 3MF`);
      const doc = xml(src);
      const objects = new Map(all(doc, 'object').map((o) => [attr(o, 'id'), o]));
      const materials = new Map();
      for (const g of all(doc, 'basematerials')) {
        materials.set(attr(g, 'id'), children(g, 'base').map((b) => ({ name: attr(b, 'name') || '', color: cleanHex(attr(b, 'displaycolor')) })));
      }
      for (const g of all(doc, 'colorgroup')) {
        materials.set(attr(g, 'id'), children(g, 'color').map((c) => ({ name: '', color: cleanHex(attr(c, 'color')) })));
      }
      models.set(key, { doc, objects, materials, path: key });
    }
    return models.get(key);
  };

  const root = model(rootPath);
  const unit = UNITS[attr(root.doc.documentElement, 'unit')] || 1;
  const slicer = readSlicer(text);
  const painted = /(paint_color|mmu_segmentation)=/.test(text(rootPath)) ||
    [...files.keys()].some((k) => k.endsWith('.model') && k !== rootPath.toLowerCase() && /(paint_color|mmu_segmentation)=/.test(text(k)));
  const byExtruder = slicer.found || painted;

  const pieces = new Map(); // clave -> { key, name, color, positions: number[] }
  const add = (key, name, color, a, b, c) => {
    let p = pieces.get(key);
    if (!p) pieces.set(key, (p = { key, name, color, positions: [] }));
    p.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };

  function emitMesh(m, obj, matrix, ctx) {
    const mesh = children(obj, 'mesh')[0];
    const vEls = all(mesh, 'vertex');
    const verts = new Float32Array(vEls.length * 3);
    const v = new THREE.Vector3();
    vEls.forEach((el, i) => {
      v.set(Number(attr(el, 'x')), Number(attr(el, 'y')), Number(attr(el, 'z'))).applyMatrix4(matrix).multiplyScalar(unit);
      verts[i * 3] = v.x; verts[i * 3 + 1] = v.y; verts[i * 3 + 2] = v.z;
    });
    const objPid = attr(obj, 'pid'), objIndex = Number(attr(obj, 'pindex')) || 0;
    const volumes = ctx.volumes || [];
    const partName = ctx.partName || attr(obj, 'name') || ctx.objectName || '';
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    const at = (vec, i) => vec.set(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);

    all(mesh, 'triangle').forEach((t, ti) => {
      const i1 = Number(attr(t, 'v1')), i2 = Number(attr(t, 'v2')), i3 = Number(attr(t, 'v3'));
      if (!(i1 * 3 < verts.length && i2 * 3 < verts.length && i3 * 3 < verts.length)) return;
      at(A, i1); at(B, i2); at(C, i3);
      if (byExtruder) {
        const vol = volumes.find((x) => ti >= x.first && ti <= x.last);
        const paint = attr(t, 'paint_color') || attr(t, 'mmu_segmentation');
        const n = (paint && paintState(paint)) || vol?.extruder || ctx.extruder || 1;
        add(`e${n}`, `Filamento ${n}`, slicer.colors[n - 1] || null, A, B, C);
        return;
      }
      const pid = attr(t, 'pid') ?? objPid;
      const group = pid != null ? m.materials.get(pid) : null;
      const entry = group?.[Number(attr(t, 'p1') ?? (attr(t, 'pid') != null ? 0 : objIndex)) || 0];
      if (entry?.color) add(`c${entry.color}`, entry.name, entry.color, A, B, C);
      else add(`o${ctx.id}`, partName, null, A, B, C);
    });
  }

  function walk(m, id, matrix, ctx, depth = 0) {
    const obj = m.objects.get(id);
    if (!obj || depth > 16 || attr(obj, 'type') === 'other') return;
    if (children(obj, 'mesh').length) emitMesh(m, obj, matrix, ctx);
    for (const comps of children(obj, 'components')) {
      for (const comp of children(comps, 'component')) {
        const path = attr(comp, 'path');
        const child = path ? model(path) : m;
        const childId = attr(comp, 'objectid');
        const next = { ...ctx, id: `${ctx.id}/${child.path}#${childId}` };
        if (depth === 0) {
          const part = slicer.part.get(`${ctx.rootId}/${childId}`);
          if (part) Object.assign(next, { extruder: part.extruder || ctx.extruder, partName: part.name || '' });
        }
        walk(child, childId, matrix.clone().multiply(parseTransform(attr(comp, 'transform'))), next, depth + 1);
      }
    }
  }

  const items = all(root.doc, 'item');
  for (const item of items) {
    if (attr(item, 'printable') === '0') continue;
    const id = attr(item, 'objectid');
    const obj = root.objects.get(id);
    const conf = slicer.object.get(id);
    walk(root, id, parseTransform(attr(item, 'transform')), {
      id: `${rootPath}#${id}`, rootId: id,
      objectName: conf?.name || (obj && attr(obj, 'name')) || '',
      extruder: conf?.extruder || 0,
      volumes: slicer.volumes.get(id),
    });
  }
  if (!pieces.size) throw new Error('El 3MF no contiene mallas 3D');
  return [...pieces.values()]
    .sort((a, b) => (a.key[0] === 'e' && b.key[0] === 'e' ? Number(a.key.slice(1)) - Number(b.key.slice(1)) : 0))
    .map((p) => ({ ...p, positions: new Float32Array(p.positions) }));
}
