// Editores del catálogo de modelos 3D (página principal). Lo carga el panel (admin.js).
import { state, dialog, esc, slug, uniqueId, markDirty } from './admin.js';
import { ModalViewer, measureFile, registerLocalFile, webglAvailable, extOf, loadModel, MODEL_EXTS, ORIGINAL } from './scenes.js';
import { ICONS } from './icons.js';

const MAX_MODEL_MB = 50;
const MAX_PARTS = 24; // más piezas que esto no se pueden personalizar una por una

export function install() {
  return {
    actions: [
      { id: 'add', icon: ICONS.plus, label: 'Modelo', run: () => itemEditor() },
      { id: 'colors', icon: ICONS.palette, label: 'Colores', run: colorsEditor },
      { id: 'info', icon: ICONS.user, label: 'Datos', run: infoEditor },
    ],
    decorateCard,
    afterGrid: addNewCard,
    // Archivos subidos que usa el catálogo (los que dejen de usarse se borran al publicar).
    files: (site) => site.items.map((i) => i.model).filter((m) => m?.startsWith('models/')),
  };
}

function decorateCard(el, item) {
  const tools = document.createElement('div');
  tools.className = 'admin-tools';
  tools.innerHTML = `
    <button type="button" data-edit>${ICONS.edit}Editar</button>
    <button type="button" data-del class="danger">${ICONS.trash}Eliminar</button>`;
  tools.querySelector('[data-edit]').addEventListener('click', () => itemEditor(item));
  tools.querySelector('[data-del]').addEventListener('click', () => removeItem(item));
  el.querySelector('.card-body').prepend(tools);
}

function addNewCard(grid) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'card card-add';
  b.innerHTML = `${ICONS.plus}<strong>Añadir modelo</strong><span>STL, 3MF, OBJ o GLB</span>`;
  b.addEventListener('click', () => itemEditor());
  grid.prepend(b);
}

function removeItem(item) {
  if (!confirm(`¿Eliminar "${item.name}" del catálogo?`)) return;
  const site = state.app.site;
  site.items = site.items.filter((i) => i !== item);
  state.pending.delete(item.model);
  markDirty();
}

/* ---------- Editor de modelos ---------- */

/* Color de filamento más parecido a un color del archivo (distancia "redmean"). */
function nearestColor(hex, colors) {
  if (!hex) return null;
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(hex);
  let best = null, bestD = Infinity;
  for (const c of colors) {
    const [r2, g2, b2] = rgb(c.hex);
    const rm = (r + r2) / 2;
    const dist = (2 + rm / 256) * (r - r2) ** 2 + 4 * (g - g2) ** 2 + (2 + (255 - rm) / 256) * (b - b2) ** 2;
    if (dist < bestD) { bestD = dist; best = c; }
  }
  return best;
}

function itemEditor(item = null) {
  const { app } = state;
  const site = app.site;
  const cats = [...new Set(site.items.map((i) => i.category).filter(Boolean))];
  const d = item?.dimensions || {};
  let model = item?.model || '';
  let viewer = null;
  const mode0 = item ? app.colorMode(item) : 'single';

  const colorChecks = site.colors.map((c) => `
    <label class="check-swatch" title="${esc(c.name)}">
      <input type="checkbox" name="colors" value="${esc(c.id)}" ${!item || !item.colors?.length || item.colors.includes(c.id) ? 'checked' : ''}>
      <span style="--c:${esc(c.hex)}"></span>${esc(c.name)}
    </label>`).join('');
  const matChecks = site.materials.map((m) => `
    <label class="check"><input type="checkbox" name="materials" value="${esc(m.id)}"
      ${!item || !item.materials?.length || item.materials.includes(m.id) ? 'checked' : ''}>${esc(m.name)}</label>`).join('');

  dialog({
    title: item ? `Editar "${item.name}"` : 'Nuevo modelo',
    wide: true,
    html: `
      <div class="editor-grid">
        <div class="editor-preview">
          <div class="editor-stage"><canvas></canvas>
            <div class="editor-empty" ${model ? 'hidden' : ''}>${ICONS.cube}<span>Sin archivo 3D</span></div>
          </div>
          <label class="btn btn-ghost btn-sm btn-block file-btn">${ICONS.upload}${item ? 'Reemplazar archivo 3D' : 'Elegir archivo 3D'}
            <input type="file" name="file" accept="${MODEL_EXTS.map((e) => `.${e}`).join(',')}" hidden></label>
          <p class="hint" data-file-info>${model && !model.startsWith('procedural:') ? esc(model.split('/').pop()) : model ? 'Modelo de demostración' : `STL, 3MF, OBJ o GLB · máx. ${MAX_MODEL_MB} MB`}</p>
        </div>
        <div class="editor-fields">
          <label class="field"><span class="field-label">Nombre *</span>
            <input name="name" required maxlength="80" value="${esc(item?.name)}"></label>
          <div class="field-row">
            <label class="field"><span class="field-label">Categoría</span>
              <input name="category" list="cat-list" maxlength="40" value="${esc(item?.category)}" placeholder="Decoración">
              <datalist id="cat-list">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
            <label class="field"><span class="field-label">Precio <small>(vacío = "Cotizar")</small></span>
              <input name="price" type="number" min="0" step="any" value="${item?.price ?? ''}"></label>
          </div>
          <label class="field"><span class="field-label">Descripción</span>
            <textarea name="description" rows="3" maxlength="400">${esc(item?.description)}</textarea></label>
          <div class="field-row three">
            <label class="field"><span class="field-label">Ancho (mm)</span><input name="w" type="number" min="0" step="any" value="${d.w ?? ''}"></label>
            <label class="field"><span class="field-label">Fondo (mm)</span><input name="d" type="number" min="0" step="any" value="${d.d ?? ''}"></label>
            <label class="field"><span class="field-label">Alto (mm)</span><input name="h" type="number" min="0" step="any" value="${d.h ?? ''}"></label>
          </div>
          <label class="field"><span class="field-label">Tiempo de impresión</span>
            <input name="printTime" maxlength="30" value="${esc(item?.printTime)}" placeholder="Ej: 3 h"></label>
          <div class="field"><span class="field-label">Materiales</span><div class="checks">${matChecks}</div></div>
          <label class="field"><span class="field-label">Colores del modelo</span>
            <select name="colorMode">
              <option value="single" ${mode0 === 'single' ? 'selected' : ''}>Un color · el cliente lo elige</option>
              <option value="parts" ${mode0 === 'parts' ? 'selected' : ''}>Multicolor · el cliente elige el color de cada pieza</option>
              <option value="original" ${mode0 === 'original' ? 'selected' : ''}>Colores del diseño · fijos, como vienen en el archivo</option>
            </select>
            <span class="hint" data-mode-hint></span></label>
          <div class="field" data-parts-field hidden><span class="field-label">Piezas <small>(nombre y color inicial)</small></span>
            <ul class="part-list" data-parts></ul></div>
          <div class="field" data-colors-field><span class="field-label" data-colors-label>Colores disponibles</span><div class="checks">${colorChecks}</div></div>
          <div class="field-row">
            <label class="field" data-default-field><span class="field-label">Color por defecto</span><select name="defaultColor"></select></label>
            <label class="check big"><input type="checkbox" name="featured" ${item?.featured ? 'checked' : ''}>Destacar en la portada</label>
          </div>
        </div>
      </div>`,
    onOpen(form) {
      const canvas = form.querySelector('.editor-stage canvas');
      const empty = form.querySelector('.editor-empty');
      const info = form.querySelector('[data-file-info]');
      const modeSel = form.elements.colorMode;
      const partsList = form.querySelector('[data-parts]');
      const modeHint = form.querySelector('[data-mode-hint]');
      const colorHex = (id) => site.colors.find((c) => c.id === id)?.hex;
      const currentPaint = () => {
        if (modeSel.value === 'original') return ORIGINAL;
        if (modeSel.value === 'parts') return [...partsList.querySelectorAll('select')].map((s) => colorHex(s.value));
        return colorHex(form.elements.defaultColor.value) || '#8d8f96';
      };
      const repaint = () => viewer?.setPaint(currentPaint());
      if (webglAvailable()) viewer = new ModalViewer(canvas, { printDuration: 3 });
      const preview = () => {
        if (!viewer || !model) return;
        viewer.start();
        viewer.show(model, currentPaint()).then(repaint).catch((err) => { info.textContent = `No se pudo mostrar: ${err.message}`; });
      };

      const syncMode = () => {
        const mode = modeSel.value;
        form.querySelector('[data-parts-field]').hidden = mode !== 'parts';
        form.querySelector('[data-colors-field]').hidden = mode === 'original';
        form.querySelector('[data-default-field]').hidden = mode !== 'single';
        form.querySelector('[data-colors-label]').textContent = mode === 'parts' ? 'Colores que puede elegir el cliente' : 'Colores disponibles';
        repaint();
      };

      // Ajusta las opciones de color a lo que trae el archivo. fresh = archivo recién subido.
      const applyParts = (parts, fresh) => {
        const own = parts.some((p) => p.color || p.map || p.vertexColors);
        const multi = parts.length > 1 && parts.length <= MAX_PARTS;
        modeSel.querySelector('[value="parts"]').disabled = !multi;
        modeSel.querySelector('[value="original"]').disabled = !own;
        const saved = !fresh && item?.parts?.length === parts.length ? item.parts : null;
        partsList.innerHTML = multi ? parts.map((p, i) => {
          const color = saved?.[i]?.color || nearestColor(p.color, site.colors)?.id || site.colors[i % site.colors.length]?.id;
          return `<li class="part-edit">
            <span class="part-orig" style="--c:${esc(p.color || 'transparent')}" title="${p.color ? 'Color que trae el archivo' : 'El archivo no trae color para esta pieza'}"></span>
            <input type="text" value="${esc(saved?.[i]?.name || p.name)}" maxlength="40" aria-label="Nombre de la pieza ${i + 1}">
            <select aria-label="Color inicial de la pieza ${i + 1}">${site.colors.map((c) => `<option value="${esc(c.id)}" ${c.id === color ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
          </li>`;
        }).join('') : '';
        if (fresh) modeSel.value = multi ? 'parts' : own ? 'original' : 'single';
        if (modeSel.selectedOptions[0]?.disabled) modeSel.value = 'single';
        const count = parts.length === 1 ? '1 pieza' : `${parts.length} piezas`;
        modeHint.textContent = parts.length > MAX_PARTS
          ? `El archivo tiene ${count}: demasiadas para elegir el color de cada una.`
          : `El archivo tiene ${count}${own ? ' con colores propios' : ' y no trae colores'}.`;
        syncMode();
      };
      partsList.addEventListener('change', repaint);
      modeSel.addEventListener('change', syncMode);
      if (model) {
        modeHint.textContent = 'Leyendo piezas del modelo…';
        loadModel(model).then((m) => applyParts(m.parts, false)).catch(() => { modeHint.textContent = ''; });
      } else {
        modeHint.textContent = 'Sube el archivo para ver sus piezas y colores.';
      }

      const syncDefault = () => {
        const checked = [...form.querySelectorAll('input[name="colors"]:checked')].map((i) => i.value);
        const list = site.colors.filter((c) => !checked.length || checked.includes(c.id));
        // Para modelos nuevos, el primer color claro (el negro casi no se ve en la vista previa).
        const bright = list.find((c) => parseInt(c.hex.slice(1, 3), 16) + parseInt(c.hex.slice(3, 5), 16) + parseInt(c.hex.slice(5, 7), 16) > 270);
        const current = form.elements.defaultColor.value || item?.defaultColor || bright?.id;
        form.elements.defaultColor.innerHTML = list.map((c) => `<option value="${esc(c.id)}" ${c.id === current ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
        repaint();
      };
      form.querySelectorAll('input[name="colors"]').forEach((i) => i.addEventListener('change', syncDefault));
      form.elements.defaultColor.addEventListener('change', repaint);
      syncDefault();
      syncMode();
      preview();

      form.elements.file.addEventListener('change', async () => {
        const file = form.elements.file.files[0];
        if (!file) return;
        const ext = extOf(file.name);
        if (!MODEL_EXTS.includes(ext)) { info.textContent = 'Formato no soportado. Usa STL, 3MF, OBJ o GLB.'; return; }
        if (file.size > MAX_MODEL_MB * 1024 * 1024) { info.textContent = `El archivo supera ${MAX_MODEL_MB} MB.`; return; }
        info.textContent = 'Leyendo archivo…';
        try {
          const { size, model: parsed } = await measureFile(file);
          const r = (v) => Math.round(v * 10) / 10;
          form.elements.w.value = r(size.x);
          form.elements.d.value = r(size.z);
          form.elements.h.value = r(size.y);
          const base = slug(file.name.replace(/\.[^.]+$/, '')) || 'modelo';
          const path = `models/${base}-${Date.now().toString(36)}.${ext}`;
          if (state.pending.has(model) && model !== item?.model) state.pending.delete(model);
          registerLocalFile(path, file);
          state.pending.set(path, file);
          model = path;
          if (!form.elements.name.value) form.elements.name.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
          info.textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB · medidas calculadas`;
          empty.hidden = true;
          applyParts(parsed.parts, true);
          preview();
        } catch (err) {
          console.warn(err);
          info.textContent = 'No se pudo leer el archivo. ¿Es un modelo 3D válido?';
        }
      });
    },
    onClose() {
      viewer?.dispose();
    },
    async onSubmit(form) {
      const f = form.elements;
      const name = f.name.value.trim();
      if (!name) throw new Error('El nombre es obligatorio.');
      if (!model) throw new Error('Sube un archivo 3D para el modelo.');
      const priceRaw = f.price.value.trim();
      if (priceRaw && !Number.isFinite(Number(priceRaw))) throw new Error('El precio debe ser un número.');
      const num = (v) => (v.value === '' ? 0 : Math.max(0, Number(v.value)) || 0);
      const colors = [...form.querySelectorAll('input[name="colors"]:checked')].map((i) => i.value);
      const materials = [...form.querySelectorAll('input[name="materials"]:checked')].map((i) => i.value);
      const colorMode = f.colorMode.value;
      const parts = [...form.querySelectorAll('.part-edit')].map((row, i) => ({
        name: row.querySelector('input').value.trim() || `Pieza ${i + 1}`,
        color: row.querySelector('select').value,
      }));
      if (colorMode === 'parts' && !parts.length) throw new Error('Espera a que se lean las piezas del archivo.');
      const data = {
        id: item?.id || uniqueId(slug(name), site.items.map((i) => i.id)),
        name,
        category: f.category.value.trim() || 'General',
        description: f.description.value.trim(),
        price: priceRaw === '' ? null : Number(priceRaw),
        dimensions: { w: num(f.w), d: num(f.d), h: num(f.h) },
        printTime: f.printTime.value.trim(),
        materials: materials.length === site.materials.length ? [] : materials,
        colors: colors.length === site.colors.length ? [] : colors,
        defaultColor: f.defaultColor.value,
        ...(colorMode !== 'single' && { colorMode }),
        ...(colorMode === 'parts' && { parts }),
        featured: f.featured.checked,
        model,
      };
      if (item) {
        if (item.model !== model) state.pending.delete(item.model);
        site.items[site.items.indexOf(item)] = data;
      } else {
        site.items.unshift(data);
      }
      markDirty();
    },
  });
}

/* ---------- Editor de colores ---------- */

function colorsEditor() {
  const { app } = state;
  const row = (c = { id: '', name: '', hex: '#e3262f' }) => `
    <li class="color-row" data-id="${esc(c.id)}">
      <input type="color" value="${esc(c.hex)}" aria-label="Color">
      <input type="text" value="${esc(c.name)}" placeholder="Nombre del color" maxlength="30" aria-label="Nombre">
      <button type="button" class="icon-btn" data-remove aria-label="Quitar color">${ICONS.trash}</button>
    </li>`;
  dialog({
    title: 'Colores de filamento disponibles',
    html: `
      <p class="dlg-text">Estos colores aparecen en el catálogo y en "Imprime tu modelo".</p>
      <ul class="color-list">${app.site.colors.map(row).join('')}</ul>
      <button type="button" class="btn btn-ghost btn-sm" data-add>${ICONS.plus}Añadir color</button>`,
    onOpen(form) {
      const list = form.querySelector('.color-list');
      form.querySelector('[data-add]').addEventListener('click', () => {
        list.insertAdjacentHTML('beforeend', row());
        list.lastElementChild.querySelector('input[type="text"]').focus();
      });
      list.addEventListener('click', (e) => { if (e.target.closest('[data-remove]')) e.target.closest('li').remove(); });
    },
    async onSubmit(form) {
      const rows = [...form.querySelectorAll('.color-row')];
      if (!rows.length) throw new Error('Debe haber al menos un color.');
      const colors = [];
      for (const r of rows) {
        const name = r.querySelector('input[type="text"]').value.trim();
        if (!name) throw new Error('Todos los colores necesitan un nombre.');
        const id = r.dataset.id || uniqueId(slug(name) || 'color', colors.map((c) => c.id).concat(app.site.colors.map((c) => c.id)));
        colors.push({ id, name, hex: r.querySelector('input[type="color"]').value });
      }
      const ids = colors.map((c) => c.id);
      app.site.colors = colors;
      for (const item of app.site.items) {
        item.colors = (item.colors || []).filter((id) => ids.includes(id));
        if (!ids.includes(item.defaultColor)) item.defaultColor = '';
        for (const p of item.parts || []) if (!ids.includes(p.color)) p.color = '';
      }
      markDirty();
    },
  });
}

/* ---------- Datos del negocio y contacto ---------- */

function infoEditor() {
  const { app } = state;
  const s = app.site, c = s.contact;
  const input = (name, label, value, extra = '') => `
    <label class="field"><span class="field-label">${label}</span><input name="${name}" value="${esc(value)}" ${extra}></label>`;
  dialog({
    title: 'Datos del negocio y contacto',
    html: `
      <div class="field-row">
        ${input('brand', 'Nombre del negocio *', s.brand, 'required maxlength="40"')}
        ${input('tagline', 'Frase corta', s.tagline, 'maxlength="60"')}
      </div>
      <div class="field-row">
        ${input('whatsapp', 'WhatsApp * <small>(código de país + número, solo dígitos)</small>', c.whatsapp, 'required inputmode="numeric" placeholder="5215512345678"')}
        ${input('whatsappDisplay', 'Cómo se muestra el número <small>(opcional)</small>', c.whatsappDisplay, 'placeholder="+52 55 1234 5678"')}
      </div>
      <label class="field"><span class="field-label">Mensaje por defecto de WhatsApp</span>
        <textarea name="whatsappMessage" rows="2" maxlength="300">${esc(c.whatsappMessage)}</textarea></label>
      <div class="field-row">
        ${input('instagram', 'Instagram <small>(usuario, sin @)</small>', c.instagram)}
        ${input('email', 'Email', c.email, 'type="email"')}
      </div>
      <div class="field-row">
        ${input('location', 'Ubicación', c.location, 'placeholder="Ciudad, país"')}
        ${input('hours', 'Horario', c.hours, 'placeholder="Lun a Sáb, 9 a 19 h"')}
      </div>
      <div class="field-row">
        ${input('currency', 'Símbolo de moneda', s.pricing.currency, 'maxlength="5"')}
        <span></span>
      </div>
      <p class="dlg-text small">Los campos vacíos (Instagram, email, ubicación, horario) se ocultan en la página.</p>`,
    async onSubmit(form) {
      const f = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim()]));
      if (!f.brand) throw new Error('El nombre del negocio es obligatorio.');
      const digits = f.whatsapp.replace(/\D/g, '');
      if (digits.length < 8) throw new Error('Revisa el número de WhatsApp: incluye código de país y solo dígitos.');
      if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) throw new Error('El email no parece válido.');
      Object.assign(s, { brand: f.brand, tagline: f.tagline });
      Object.assign(s.contact, {
        whatsapp: digits, whatsappDisplay: f.whatsappDisplay, whatsappMessage: f.whatsappMessage,
        instagram: f.instagram.replace(/^@/, ''), email: f.email, location: f.location, hours: f.hours,
      });
      s.pricing.currency = f.currency || '$';
      markDirty();
    },
  });
}
