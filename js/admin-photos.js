// Fotos en el panel: se reducen y convierten a WebP en el navegador (foto + miniatura) antes de publicarse.
// Lo usan los editores de figuras y de modelos 3D.
import { state, esc } from './admin.js';
import { ICONS } from './icons.js';

const MAX_INPUT_MB = 30;
const FULL_SIDE = 1600; // lado mayor de la foto que se ve en el visor
const THUMB_SIDE = 640; // lado mayor de la miniatura
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif'];

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

/* Convierte una foto subida en dos archivos pendientes de publicar y devuelve { src, thumb, w, h }. */
export async function preparePhoto(file, folder, base) {
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
  const photo = { src: `${folder}/${id}.${full.ext}`, thumb: `${folder}/${id}-sm.${thumb.ext}`, w: full.w, h: full.h };
  for (const [path, { blob }] of [[photo.src, full], [photo.thumb, thumb]]) {
    state.pending.set(path, blob);
    state.app.localFiles.set(path, URL.createObjectURL(blob));
  }
  return photo;
}

/* Rutas de los archivos de una lista de fotos (para saber qué se usa y qué borrar). */
export const photoFiles = (photos) => (photos || []).flatMap((p) => [p.src, p.thumb]).filter((p) => p?.startsWith('images/'));

/* Marcado del campo de fotos; se activa con mountPhotoField. */
export function photoFieldHtml({ max, label = 'Añadir fotos', hint = '' }) {
  return `
    <ul class="photo-list" data-photos></ul>
    <label class="photo-drop" data-drop>
      ${ICONS.upload}<strong>${esc(label)}</strong><span>Arrastra aquí o toca para elegir · hasta ${max}</span>
      <input type="file" accept="${IMAGE_TYPES.join(',')}" multiple hidden>
    </label>
    <p class="hint" data-photo-info>${esc(hint)}</p>`;
}

/* Lista editable de fotos: añadir, reordenar (la primera es la portada) y quitar. Modifica `photos`. */
export function mountPhotoField(root, photos, { max, folder, baseName, coverLabel = 'Portada' }) {
  const list = root.querySelector('[data-photos]');
  const info = root.querySelector('[data-photo-info]');
  const drop = root.querySelector('[data-drop]');
  const input = drop.querySelector('input');
  const initialHint = info.textContent;

  const draw = () => {
    list.innerHTML = photos.map((p, i) => `
      <li class="photo-item">
        <img src="${esc(state.app.fileUrl(p.thumb || p.src))}" alt="Foto ${i + 1}">
        ${i === 0 && coverLabel ? `<span class="photo-cover">${esc(coverLabel)}</span>` : ''}
        <div class="photo-tools">
          <button type="button" class="icon-btn" data-move="-1" data-i="${i}" aria-label="Mover antes" ${i === 0 ? 'disabled' : ''}>‹</button>
          <button type="button" class="icon-btn" data-move="1" data-i="${i}" aria-label="Mover después" ${i === photos.length - 1 ? 'disabled' : ''}>›</button>
          <button type="button" class="icon-btn" data-remove="${i}" aria-label="Quitar foto">${ICONS.trash}</button>
        </div>
      </li>`).join('');
    drop.hidden = photos.length >= max;
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
    const room = max - photos.length;
    const picked = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|heic|heif)$/i.test(f.name)).slice(0, room);
    if (!picked.length) { info.textContent = 'Solo se pueden subir imágenes (JPG, PNG o WebP).'; return; }
    let done = 0;
    for (const f of picked) {
      info.textContent = `Optimizando foto ${++done} de ${picked.length}…`;
      try {
        photos.push(await preparePhoto(f, folder, baseName() || 'foto'));
        draw();
      } catch (err) {
        info.textContent = err.message;
        return;
      }
    }
    info.textContent = files.length > room ? `Solo se añadieron ${room}: el máximo es ${max} fotos.` : initialHint || 'Fotos listas.';
  };
  input.addEventListener('change', () => { add(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (e) => add(e.dataTransfer.files));
  draw();
}
