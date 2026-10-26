// Editores de la vista /figuras/ (galería de fotos). Lo carga el panel (admin.js).
// Aquí solo se suben imágenes (ver admin-photos.js).
import { state, dialog, esc, slug, uniqueId, markDirty } from './admin.js';
import { ICONS } from './icons.js';
import { photoFieldHtml, mountPhotoField, photoFiles } from './admin-photos.js';

const MAX_PHOTOS = 12;

export function install() {
  return {
    actions: [
      { id: 'add', icon: ICONS.plus, label: 'Figura', run: () => figureEditor() },
      { id: 'texts', icon: ICONS.edit, label: 'Textos', run: textsEditor },
    ],
    decorateCard,
    afterGrid: addNewCard,
    // Fotos subidas que usa la galería (las que dejen de usarse se borran al publicar).
    files: (figs) => (figs.items || []).flatMap((i) => photoFiles(i.photos)),
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
          ${photoFieldHtml({ max: MAX_PHOTOS, hint: 'La primera foto es la portada. Se reducen y optimizan solas antes de publicar.' })}
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
      mountPhotoField(form.querySelector('.editor-preview'), photos, {
        max: MAX_PHOTOS, folder: 'images/figuras', baseName: () => slug(form.elements.name.value) || 'figura',
      });
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
