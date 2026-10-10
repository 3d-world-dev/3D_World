// Editores de la vista /figuras/ (galería de fotos). Lo carga el panel (admin.js).
// Aquí solo se suben imágenes: se reducen y convierten a WebP en el navegador antes de publicarlas.
import { state, dialog, esc, slug, uniqueId, markDirty } from './admin.js';
import { ICONS } from './icons.js';

const MAX_PHOTOS = 12;
const MAX_INPUT_MB = 30;
const FULL_SIDE = 1600; // lado mayor de la foto que se ve en el visor
const THUMB_SIDE = 640; // lado mayor de la miniatura de la galería
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif'];

export function install() {
  return {
    actions: [
      { id: 'add', icon: ICONS.plus, label: 'Figura', run: () => figureEditor() },
      { id: 'texts', icon: ICONS.edit, label: 'Textos', run: textsEditor },
    ],
    decorateCard,
    afterGrid: addNewCard,
    // Fotos subidas que usa la galería (las que dejen de usarse se borran al publicar).
    files: (figs) => (figs.items || []).flatMap((i) => (i.photos || []).flatMap((p) => [p.src, p.thumb]))
      .filter((p) => p?.startsWith('images/')),
  };
}

/* ---------- Tarjetas ---------- */

function decorateCard(el, item) {
  const tools = document.createElement('div');
  tools.className = 'admin-tools';
  tools.innerHTML = `
    <button type="button" data-edit>${ICONS.edit}Editar</button>
    <button type="button" data-del class="danger">${ICONS.trash}Eliminar</button>`;
  tools.querySelector('[data-edit]').addEventListener('click', () => figureEditor(item));
  tools.querySelector('[data-del]').addEventListener('click', () => {
    if (!confirm(`¿Eliminar "${item.name}" de la galería?`)) return;
    const figs = state.app.figs;
    figs.items = figs.items.filter((i) => i !== item);
    markDirty();
  });
  el.querySelector('.fx-body').prepend(tools);
}

function addNewCard(grid) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fx-card fx-add';
  b.innerHTML = `${ICONS.plus}<strong>Añadir figura</strong><span>Sube fotos JPG, PNG o WebP</span>`;
  b.addEventListener('click', () => figureEditor());
  grid.prepend(b);
}

/* ---------- Fotos ---------- */

async function encode(bitmap, side, quality) {
  const k = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * k), h = Math.round(bitmap.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  const toBlob = (type) => new Promise((r) => canvas.toBlob(r, type, quality));
  let blob = await toBlob('image/webp');
  // Safari antiguo no sabe generar WebP: se usa JPG.
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg');
  return { blob, w, h, ext: blob.type === 'image/webp' ? 'webp' : 'jpg' };
}

/* Convierte una foto subida en dos archivos listos para publicar (grande y miniatura). */
async function preparePhoto(file, base) {
  if (file.size > MAX_INPUT_MB * 1024 * 1024) throw new Error(`"${file.name}" pesa más de ${MAX_INPUT_MB} MB.`);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`No se pudo leer "${file.name}". Usa fotos JPG, PNG o WebP.`);
  }
  const full = await encode(bitmap, FULL_SIDE, 0.86);
  const thumb = await encode(bitmap, THUMB_SIDE, 0.8);
  bitmap.close?.();
  const id = `${base}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const photo = { src: `images/figuras/${id}.${full.ext}`, thumb: `images/figuras/${id}-sm.${thumb.ext}`, w: full.w, h: full.h };
  for (const [path, { blob }] of [[photo.src, full], [photo.thumb, thumb]]) {
    state.pending.set(path, blob);
    state.app.localFiles.set(path, URL.createObjectURL(blob));
  }
  return photo;
}

/* ---------- Editor de figura ---------- */

function figureEditor(item = null) {
  const { app } = state;
  const figs = app.figs;
  const series = [...new Set(figs.items.map((i) => i.series).filter(Boolean))];
  const photos = (item?.photos || []).map((p) => ({ ...p }));
  const status = app.STATUS[item?.status] ? item.status : 'encargo';

  dialog({
    title: item ? `Editar "${item.name}"` : 'Nueva figura',
    wide: true,
    html: `
      <div class="editor-grid">
        <div class="editor-preview">
          <ul class="photo-list" data-photos></ul>
          <label class="photo-drop" data-drop>
            ${ICONS.upload}<strong>Añadir fotos</strong><span>Arrastra aquí o toca para elegir · hasta ${MAX_PHOTOS}</span>
            <input type="file" name="photos" accept="${IMAGE_TYPES.join(',')}" multiple hidden>
          </label>
          <p class="hint" data-photo-info>La primera foto es la portada. Se reducen y optimizan solas antes de publicar.</p>
        </div>
        <div class="editor-fields">
          <label class="field"><span class="field-label">Nombre *</span>
            <input name="name" required maxlength="80" value="${esc(item?.name)}" placeholder="Ej: Guerrera con katana"></label>
          <label class="field"><span class="field-label">Serie o anime <small>(sirve para filtrar)</small></span>
            <input name="series" list="series-list" maxlength="50" value="${esc(item?.series)}" placeholder="Ej: Original">
            <datalist id="series-list">${series.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></label>
          <label class="field"><span class="field-label">Descripción</span>
            <textarea name="description" rows="3" maxlength="500">${esc(item?.description)}</textarea></label>
          <div class="field-row three">
            <label class="field"><span class="field-label">Altura (cm)</span>
              <input name="height" type="number" min="0" step="any" value="${item?.height ?? ''}"></label>
            <label class="field"><span class="field-label">Precio <small>(vacío = consultar)</small></span>
              <input name="price" type="number" min="0" step="any" value="${item?.price ?? ''}"></label>
            <label class="field"><span class="field-label">Estado</span>
              <select name="status">${Object.entries(app.STATUS).map(([k, v]) => `<option value="${k}" ${k === status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          </div>
          <label class="check big"><input type="checkbox" name="featured" ${item?.featured ? 'checked' : ''}>Destacar en la portada</label>
        </div>
      </div>`,
    onOpen(form) {
      const list = form.querySelector('[data-photos]');
      const info = form.querySelector('[data-photo-info]');
      const input = form.elements.photos;
      const drop = form.querySelector('[data-drop]');

      const draw = () => {
        list.innerHTML = photos.map((p, i) => `
          <li class="photo-item">
            <img src="${esc(app.fileUrl(p.thumb || p.src))}" alt="Foto ${i + 1}">
            ${i === 0 ? '<span class="photo-cover">Portada</span>' : ''}
            <div class="photo-tools">
              <button type="button" class="icon-btn" data-move="-1" data-i="${i}" aria-label="Mover antes" ${i === 0 ? 'disabled' : ''}>‹</button>
              <button type="button" class="icon-btn" data-move="1" data-i="${i}" aria-label="Mover después" ${i === photos.length - 1 ? 'disabled' : ''}>›</button>
              <button type="button" class="icon-btn" data-remove="${i}" aria-label="Quitar foto">${ICONS.trash}</button>
            </div>
          </li>`).join('');
        drop.hidden = photos.length >= MAX_PHOTOS;
      };
      list.addEventListener('click', (e) => {
        const move = e.target.closest('[data-move]');
        const remove = e.target.closest('[data-remove]');
        if (move) {
          const i = Number(move.dataset.i), j = i + Number(move.dataset.move);
          [photos[i], photos[j]] = [photos[j], photos[i]];
        }
        if (remove) photos.splice(Number(remove.dataset.remove), 1);
        draw();
      });

      const add = async (files) => {
        const room = MAX_PHOTOS - photos.length;
        const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|heic|heif)$/i.test(f.name)).slice(0, room);
        if (!list.length) { info.textContent = 'Solo se pueden subir imágenes (JPG, PNG o WebP).'; return; }
        const base = slug(form.elements.name.value) || 'figura';
        let done = 0;
        for (const f of list) {
          info.textContent = `Optimizando foto ${++done} de ${list.length}…`;
          try {
            photos.push(await preparePhoto(f, base));
            draw();
          } catch (err) {
            info.textContent = err.message;
            return;
          }
        }
        info.textContent = files.length > room ? `Solo se añadieron ${room}: el máximo es ${MAX_PHOTOS} fotos por figura.` : 'Fotos listas. La primera es la portada.';
      };
      input.addEventListener('change', () => { add(input.files); input.value = ''; });
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
      drop.addEventListener('drop', (e) => add(e.dataTransfer.files));
      draw();
    },
    async onSubmit(form) {
      const f = form.elements;
      const name = f.name.value.trim();
      if (!name) throw new Error('El nombre es obligatorio.');
      if (!photos.length) throw new Error('Añade al menos una foto.');
      const num = (v) => (v.trim() === '' ? null : Math.max(0, Number(v)));
      const price = num(f.price.value), height = num(f.height.value);
      if (Number.isNaN(price) || Number.isNaN(height)) throw new Error('Altura y precio deben ser números.');
      const data = {
        id: item?.id || uniqueId(slug(name), figs.items.map((i) => i.id)),
        name,
        series: f.series.value.trim(),
        description: f.description.value.trim(),
        height,
        price,
        status: f.status.value,
        featured: f.featured.checked,
        photos,
      };
      if (item) figs.items[figs.items.indexOf(item)] = data;
      else figs.items.unshift(data);
      markDirty();
    },
  });
}

/* ---------- Textos de la portada ---------- */

function textsEditor() {
  const figs = state.app.figs;
  dialog({
    title: 'Textos de la portada',
    html: `
      <label class="field"><span class="field-label">Título</span>
        <input name="title" maxlength="60" value="${esc(figs.title)}" placeholder="Figuras pintadas a mano"></label>
      <label class="field"><span class="field-label">Presentación</span>
        <textarea name="intro" rows="4" maxlength="300">${esc(figs.intro)}</textarea></label>
      <p class="dlg-text small">El WhatsApp, Instagram y demás datos de contacto se editan en la página principal (botón Datos) y se usan en las dos vistas.</p>`,
    async onSubmit(form) {
      figs.title = form.elements.title.value.trim();
      figs.intro = form.elements.intro.value.trim();
      markDirty();
    },
  });
}
