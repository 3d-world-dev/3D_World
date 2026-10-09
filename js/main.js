// Punto de entrada: carga data/site.json y arma toda la página.
// Three.js se importa de forma dinámica: si falla (sin internet o sin WebGL) el catálogo sigue funcionando.
import { ICONS } from './icons.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmt = (n, d = 0) => Number(n).toLocaleString('es', { maximumFractionDigits: d });

const app = {
  site: null,
  scenes: null,
  grid: null,
  hero: null,
  cards: [],
  hooks: {},
  state: { filter: 'all', query: '' },
};

/* ---------- Utilidades de datos ---------- */

function fillIcons(root = document) {
  for (const el of $$('[data-icon]', root)) {
    if (el.dataset.filled) continue;
    el.innerHTML = ICONS[el.dataset.icon] || '';
    el.dataset.filled = '1';
  }
}

function waLink(text) {
  const number = String(app.site.contact.whatsapp || '').replace(/\D/g, '');
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

const allColors = () => app.site.colors;
const FALLBACK_COLOR = { id: '', name: '', hex: '#8d8f96' };

function itemColors(item) {
  const ids = item.colors?.length ? item.colors : null;
  const list = ids ? allColors().filter((c) => ids.includes(c.id)) : allColors();
  return list.length ? list : allColors();
}

function defaultColor(item) {
  const list = itemColors(item);
  return list.find((c) => c.id === item.defaultColor) || list[0] || FALLBACK_COLOR;
}

function itemMaterials(item) {
  const known = app.site.materials.map((m) => m.id);
  const list = (item.materials || []).filter((m) => known.includes(m));
  return list.length ? list : known;
}

function priceText(item) {
  if (item.price === null || item.price === undefined || item.price === '') return 'Cotizar';
  const n = Number(item.price);
  return Number.isFinite(n) ? `${app.site.pricing.currency}${fmt(n, 2)}` : String(item.price);
}

function formatDims(d) {
  if (!d || !(d.w || d.d || d.h)) return '';
  return `${[d.w, d.d, d.h].map((v) => fmt((v || 0) / 10, 1)).join(' × ')} cm`;
}

function interestMessage(item, color, material) {
  let msg = `¡Hola! Me interesa el modelo "${item.name}"`;
  if (material) msg += ` en ${material}`;
  if (color?.name) msg += ` color ${color.name.toLowerCase()}`;
  return `${msg}. ¿Me pueden dar más información?`;
}

/* ---------- Componentes ---------- */

function renderSwatches(container, list, selectedId, onPick, { max = Infinity, onMore } = {}) {
  container.innerHTML = '';
  for (const c of list.slice(0, max)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.setProperty('--c', c.hex);
    b.title = c.name;
    b.dataset.id = c.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', c.name);
    b.setAttribute('aria-checked', String(c.id === selectedId));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      selectSwatch(container, c.id);
      onPick(c);
    });
    container.append(b);
  }
  if (list.length > max) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'swatch-more';
    more.textContent = `+${list.length - max}`;
    more.setAttribute('aria-label', `Ver ${list.length - max} colores más`);
    more.addEventListener('click', (e) => { e.stopPropagation(); onMore?.(); });
    container.append(more);
  }
}

function selectSwatch(container, id) {
  for (const s of $$('.swatch', container)) s.setAttribute('aria-checked', String(s.dataset.id === id));
}

function toast(message, type = 'info', ms = 4500) {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = message;
  $('#toasts').append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

/* ---------- Render principal (se vuelve a llamar cuando el dueño edita) ---------- */

function render() {
  const s = app.site;
  $$('[data-brand]').forEach((el) => { el.textContent = s.brand; });
  $$('[data-tagline]').forEach((el) => { el.textContent = s.tagline; });
  document.title = `${s.brand} — ${s.tagline}`;
  $$('[data-wa]').forEach((a) => { a.href = waLink(s.contact.whatsappMessage); });
  $('#idea-link').href = waLink('¡Hola! Tengo una idea para imprimir en 3D y quisiera cotizarla: ');
  $('#hud-layer-height').textContent = `${fmt(s.printer.layerHeight || 0.2, 2)} mm`;
  renderHeroTags();
  renderHero();
  renderCatalog();
  renderMaterials();
  renderUploadOptions();
  renderContact();
}

function renderHeroTags() {
  const tags = [...app.site.materials.map((m) => m.name), `${allColors().length} colores`];
  $('#hero-tags').innerHTML = tags.map((t) => `<li>${esc(t)}</li>`).join('');
}

function renderHero() {
  renderSwatches($('#hero-colors'), allColors().slice(0, 6), null, (c) => app.hero?.setColor(c.hex));
  if (!app.hero) return;
  const items = app.site.items;
  const featured = items.filter((i) => i.featured);
  let list = featured.length ? featured : items.slice(0, 4);
  if (!list.length) list = [{ id: '', name: 'Jarrón de muestra', model: 'procedural:twistVase', dimensions: { h: 160 } }];
  app.hero.setItems(list, (item) => defaultColor(item).hex);
}

function heroCallbacks() {
  const layerEl = $('#hud-layer'), totalEl = $('#hud-total'), bar = $('#hud-progress'), modelBtn = $('#hud-model');
  const label = $('.hud-label');
  let last = -1;
  return {
    onModel(item) {
      modelBtn.textContent = item.name;
      modelBtn.disabled = !item.id;
      modelBtn.onclick = () => item.id && openModal(item);
      last = -1;
    },
    onProgress(p, item) {
      const total = Math.max(1, Math.round((item.dimensions?.h || 100) / (app.site.printer.layerHeight || 0.2)));
      const layer = Math.round(p * total);
      if (layer === last) return;
      last = layer;
      layerEl.textContent = fmt(layer);
      totalEl.textContent = fmt(total);
      bar.style.transform = `scaleX(${p})`;
      label.textContent = p < 1 ? 'Imprimiendo' : 'Impreso';
    },
  };
}

/* ---------- Catálogo ---------- */

function renderCatalog() {
  const grid = $('#grid');
  app.grid?.clear();
  grid.innerHTML = '';
  app.cards = app.site.items.map(buildCard);
  app.hooks.afterGrid?.(grid);
  renderChips();
  applyFilter();
}

function buildCard(item) {
  const card = { item, color: defaultColor(item), material: itemMaterials(item)[0] };
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.id = item.id;
  el.innerHTML = `
    <button class="card-view" type="button" aria-label="Ver ${esc(item.name)} en 3D">
      <span class="loader" aria-hidden="true"></span>
      <span class="card-fallback" aria-hidden="true">${ICONS.cube}</span>
      ${item.featured ? '<span class="badge">Destacado</span>' : ''}
    </button>
    <div class="card-body">
      <div class="card-meta"><span class="tag">${esc(item.category)}</span><span class="price">${esc(priceText(item))}</span></div>
      <h3 class="card-title">${esc(item.name)}</h3>
      <p class="card-desc">${esc(item.description)}</p>
      <div class="swatches swatches-sm" role="radiogroup" aria-label="Color"></div>
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-open>Ver en 3D</button>
        <a class="btn btn-wa btn-sm" target="_blank" rel="noopener" data-interest>${ICONS.whatsapp}Me interesa</a>
      </div>
    </div>`;
  card.el = el;
  const view = $('.card-view', el);
  const swatches = $('.swatches', el);
  const wa = $('[data-interest]', el);
  card.updateLink = () => { wa.href = waLink(interestMessage(item, card.color, card.material)); };
  card.setColor = (c) => {
    card.color = c;
    selectSwatch(swatches, c.id);
    if (card.handle) app.grid.setColor(card.handle, c.hex);
    card.updateLink();
  };
  renderSwatches(swatches, itemColors(item), card.color.id, card.setColor, { max: 6, onMore: () => openModal(item, card) });
  card.updateLink();
  view.addEventListener('click', () => openModal(item, card));
  $('[data-open]', el).addEventListener('click', () => openModal(item, card));
  if (app.grid) card.handle = app.grid.add(view, item.model, card.color.hex);
  app.hooks.decorateCard?.(el, item);
  $('#grid').append(el);
  return card;
}

function renderChips() {
  const cats = [...new Set(app.site.items.map((i) => i.category).filter(Boolean))];
  if (app.state.filter !== 'all' && !cats.includes(app.state.filter)) app.state.filter = 'all';
  const count = (c) => app.site.items.filter((i) => c === 'all' || i.category === c).length;
  $('#chips').innerHTML = ['all', ...cats].map((c) => `
    <button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === app.state.filter}">
      ${c === 'all' ? 'Todos' : esc(c)} <span>${count(c)}</span>
    </button>`).join('');
}

function applyFilter() {
  const q = norm(app.state.query.trim());
  let visible = 0;
  for (const card of app.cards) {
    const { item } = card;
    const okCat = app.state.filter === 'all' || item.category === app.state.filter;
    const okQ = !q || norm(`${item.name} ${item.description} ${item.category}`).includes(q);
    card.el.hidden = !(okCat && okQ);
    if (!card.el.hidden) visible++;
  }
  $('#empty').hidden = visible > 0 || !app.site.items.length;
}

function setupFilters() {
  $('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    app.state.filter = chip.dataset.cat;
    $$('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    applyFilter();
  });
  $('#search').addEventListener('input', (e) => {
    app.state.query = e.target.value;
    applyFilter();
  });
}

/* ---------- Ficha (modal) ---------- */

let modalViewer = null;
let modalState = null;

function openModal(item, card = app.cards.find((c) => c.item === item)) {
  const modal = $('#modal');
  modalState = {
    item, card,
    color: card?.color || defaultColor(item),
    material: card?.material || itemMaterials(item)[0],
  };
  $('#m-cat').textContent = item.category || '';
  $('#m-title').textContent = item.name;
  $('#m-desc').textContent = item.description || '';
  const specs = [
    ['Medidas', formatDims(item.dimensions)],
    ['Tiempo de impresión', item.printTime ? `≈ ${item.printTime}` : ''],
  ].filter(([, v]) => v);
  $('#m-specs').innerHTML = specs.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');

  const mats = itemMaterials(item);
  $('#m-material-field').hidden = !mats.length;
  $('#m-materials').innerHTML = mats.map((m) => `<button type="button" role="radio" aria-checked="${m === modalState.material}" data-m="${esc(m)}">${esc(m)}</button>`).join('');

  renderSwatches($('#m-colors'), itemColors(item), modalState.color.id, (c) => {
    modalState.color = c;
    $('#m-color-name').textContent = c.name;
    modalViewer?.setColor(c.hex);
    modalState.card?.setColor(c);
    updateModalLink();
  });
  $('#m-color-name').textContent = modalState.color.name;
  $('#m-price').textContent = priceText(item);
  updateModalLink();

  if (modal.hidden) {
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('open'));
    document.documentElement.classList.add('modal-open');
    app.grid?.setPaused(true);
    if (!history.state?.modal) history.pushState({ modal: true }, '');
  }
  $('.modal-close', modal).focus({ preventScroll: true });

  if (app.scenes) {
    modalViewer ??= new app.scenes.ModalViewer($('#modal-canvas'));
    modalViewer.start();
    modalViewer.show(item.model, modalState.color.hex).catch((err) => {
      console.warn(err);
      toast('No se pudo cargar el modelo 3D.', 'error');
    });
  }
}

function updateModalLink() {
  $('#m-wa').href = waLink(interestMessage(modalState.item, modalState.color, modalState.material));
}

function closeModal(fromHistory = false) {
  const modal = $('#modal');
  if (modal.hidden) return;
  modal.classList.remove('open');
  document.documentElement.classList.remove('modal-open');
  setTimeout(() => {
    modal.hidden = true;
    modalViewer?.stop();
  }, 250);
  app.grid?.setPaused(false);
  if (!fromHistory && history.state?.modal) history.back();
}

function setupModal() {
  const modal = $('#modal');
  modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  window.addEventListener('popstate', () => closeModal(true));
  $('#m-materials').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    modalState.material = b.dataset.m;
    $$('#m-materials button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    if (modalState.card) {
      modalState.card.material = b.dataset.m;
      modalState.card.updateLink();
    }
    updateModalLink();
  });
  $('#m-print').addEventListener('click', () => modalViewer?.replay());
  $('#m-wire').addEventListener('click', (e) => {
    if (modalViewer) e.currentTarget.setAttribute('aria-pressed', String(modalViewer.toggleWire()));
  });
  $('#m-rotate').addEventListener('click', (e) => {
    if (modalViewer) e.currentTarget.setAttribute('aria-pressed', String(modalViewer.toggleRotate()));
  });
  if (app.scenes?.REDUCED_MOTION) $('#m-rotate').setAttribute('aria-pressed', 'false');
}

/* ---------- Materiales y contacto ---------- */

function renderMaterials() {
  $('#materials').innerHTML = app.site.materials.map((m) => `
    <article class="material reveal">
      <h3>${esc(m.name)}</h3>
      <p>${esc(m.description)}</p>
      <ul class="stats">
        ${Object.entries(m.stats || {}).map(([k, v]) => `
          <li><span>${esc(k)}</span><span class="bar" role="img" aria-label="${esc(k)}: ${v} de 5"><i style="--v:${Math.max(0, Math.min(5, v)) / 5}"></i></span></li>`).join('')}
      </ul>
    </article>`).join('');
  observeReveal($('#materials'));
}

function renderContact() {
  const c = app.site.contact;
  const digits = String(c.whatsapp || '').replace(/\D/g, '');
  const ig = String(c.instagram || '').replace(/^@/, '').trim();
  const rows = [
    { icon: 'whatsapp', label: 'WhatsApp', value: c.whatsappDisplay || `+${digits}`, href: waLink(c.whatsappMessage), cls: 'is-wa' },
    ig && { icon: 'instagram', label: 'Instagram', value: `@${ig}`, href: `https://instagram.com/${encodeURIComponent(ig)}` },
    c.email && { icon: 'mail', label: 'Email', value: c.email, href: `mailto:${c.email}` },
    c.location && { icon: 'pin', label: 'Ubicación', value: c.location, href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.location)}` },
    c.hours && { icon: 'clock', label: 'Horario', value: c.hours },
  ].filter(Boolean);
  $('#contact-list').innerHTML = rows.map((r) => {
    const inner = `<span class="contact-icon">${ICONS[r.icon]}</span><span><small>${r.label}</small><strong>${esc(r.value)}</strong></span>`;
    return `<li class="${r.cls || ''}">${r.href ? `<a href="${esc(r.href)}" target="_blank" rel="noopener">${inner}</a>` : `<div>${inner}</div>`}</li>`;
  }).join('');
}

/* ---------- "Imprime tu modelo" ---------- */

let uploadViewer = null;
const upload = { file: null, size: null, volume: 0, scale: 1, material: null, color: null };

function renderUploadOptions() {
  const mats = app.site.materials;
  if (!mats.some((m) => m.id === upload.material)) upload.material = mats[0]?.id;
  $('#upload-material').innerHTML = mats.map((m) => `<option value="${esc(m.id)}" ${m.id === upload.material ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  if (!allColors().some((c) => c.id === upload.color?.id)) {
    // Primer color que se distinga bien sobre la cama oscura.
    const luminance = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    };
    upload.color = allColors().find((c) => luminance(c.hex) > 0.35) || allColors()[0] || FALLBACK_COLOR;
  }
  renderSwatches($('#upload-colors'), allColors(), upload.color.id, (c) => {
    upload.color = c;
    uploadViewer?.setColor(c.hex);
    updateUpload();
  });
  updateUpload();
}

function uploadError(msg) {
  const el = $('#upload-error');
  el.textContent = msg || '';
  el.hidden = !msg;
}

async function handleFile(file) {
  uploadError('');
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['stl', 'obj', 'glb'].includes(ext)) return uploadError('Formato no soportado. Usa un archivo STL, OBJ o GLB.');
  if (file.size > 150 * 1024 * 1024) return uploadError('El archivo pesa más de 150 MB. Envíanoslo directo por WhatsApp.');
  if (!app.scenes) return uploadError('Tu navegador no puede mostrar modelos 3D. Envíanos el archivo directo por WhatsApp.');
  $('#dz-loading').hidden = false;
  try {
    uploadViewer ??= new app.scenes.UploadViewer($('#upload-canvas'), app.site.printer);
    const { size, volume } = await uploadViewer.load(file, upload.color.hex);
    Object.assign(upload, { file, size, volume });
    $('#file-name').textContent = file.name;
    $('#dz-empty').hidden = true;
    $('#dropzone').classList.add('has-model');
    $('#upload-panel').hidden = false;
    updateUpload();
  } catch (err) {
    console.warn(err);
    uploadError('No pudimos leer ese archivo. Revisa que sea un modelo 3D válido o envíanoslo por WhatsApp.');
  } finally {
    $('#dz-loading').hidden = true;
  }
}

function updateUpload() {
  $('#upload-color-name').textContent = upload.color?.name || '';
  if (!upload.size) return;
  const s = upload.scale;
  const { size } = upload;
  const dims = [size.x, size.z, size.y].map((v) => v * s);
  const cm3 = (upload.volume * s ** 3) / 1000;
  const mat = app.site.materials.find((m) => m.id === upload.material);
  const pricing = app.site.pricing;
  const grams = cm3 * (mat?.density || 1.24) * (pricing.fillFactor || 0.35);
  $('#spec-size').textContent = `${dims.map((v) => fmt(v, 1)).join(' × ')} mm`;
  $('#spec-volume').textContent = `${fmt(cm3, 1)} cm³`;
  $('#spec-weight').textContent = `≈ ${fmt(grams)} g`;
  const showPrice = Number(pricing.perGram) > 0;
  $('#spec-price-row').hidden = !showPrice;
  if (showPrice) {
    const price = Math.max(Number(pricing.minimum) || 0, grams * Number(pricing.perGram));
    $('#spec-price').textContent = `≈ ${pricing.currency}${fmt(price, 2)}`;
  }
  const p = app.site.printer;
  const warn = $('#fit-warning');
  warn.hidden = uploadViewer.fits(s);
  warn.textContent = `Con esta escala no cabe en nuestra impresora (${p.x} × ${p.y} × ${p.z} mm). Podemos reducirlo o imprimirlo en partes.`;
  const qty = Math.max(1, parseInt($('#qty').value, 10) || 1);
  const lines = [
    '¡Hola! Quiero imprimir un modelo propio:',
    `• Archivo: ${upload.file.name}`,
    `• Medidas: ${dims.map((v) => fmt(v, 1)).join(' × ')} mm${s !== 1 ? ` (escala ${Math.round(s * 100)}%)` : ''}`,
    `• Material: ${mat?.name || '-'} · Color: ${upload.color?.name || '-'}`,
    `• Cantidad: ${qty}`,
    'Les envío el archivo por aquí.',
  ];
  $('#upload-wa').href = waLink(lines.join('\n'));
}

function setupUpload() {
  const dz = $('#dropzone'), input = $('#file-input');
  const pick = () => input.click();
  dz.addEventListener('click', () => { if (!upload.file) pick(); });
  dz.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !upload.file) { e.preventDefault(); pick(); }
  });
  $('#file-change').addEventListener('click', pick);
  input.addEventListener('change', () => {
    if (input.files[0]) handleFile(input.files[0]);
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  $('#scale').addEventListener('input', (e) => {
    upload.scale = Number(e.target.value) / 100;
    $('#scale-out').textContent = `${e.target.value}%`;
    uploadViewer?.setScale(upload.scale);
    updateUpload();
  });
  $('#upload-material').addEventListener('change', (e) => { upload.material = e.target.value; updateUpload(); });
  $('#qty').addEventListener('input', updateUpload);
}

/* ---------- Efectos generales ---------- */

function setupTheme() {
  const root = document.documentElement;
  const btn = $('#theme-toggle');
  const sync = () => {
    const light = root.dataset.theme === 'light';
    btn.setAttribute('aria-label', light ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
    $('meta[name="theme-color"]').content = light ? '#f4f4f5' : '#0a0a0b';
  };
  btn.addEventListener('click', () => {
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    try { localStorage.setItem('3dw-theme', next); } catch { /* sin almacenamiento */ }
    sync();
  });
  sync();
}

function setupNav() {
  const nav = $('#nav'), toggle = $('#nav-toggle'), links = $('#nav-links');
  const setOpen = (open) => {
    nav.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  };
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('menu-open')));
  links.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
}

function setupScrollEffects() {
  const nav = $('#nav'), bar = $('#scroll-progress');
  let ticking = false;
  const update = () => {
    ticking = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
    nav.classList.toggle('scrolled', scrollY > 10);
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
  const hero = $('.hero');
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    hero.style.setProperty('--mx', `${e.clientX - r.left}px`);
    hero.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
}

let revealObserver;
function observeReveal(root = document) {
  revealObserver ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      revealObserver.unobserve(e.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  $$('.reveal:not(.in)', root).forEach((el) => revealObserver.observe(el));
}

/* ---------- Acceso secreto al panel ---------- */

async function openAdmin() {
  try {
    const mod = await import('./admin.js');
    mod.startAdmin(app);
  } catch (err) {
    console.error(err);
    toast('No se pudo abrir el panel.', 'error');
  }
}

function setupSecret() {
  let taps = 0, timer;
  $('#secret-logo').addEventListener('click', () => {
    taps++;
    clearTimeout(timer);
    timer = setTimeout(() => { taps = 0; }, 1500);
    if (taps >= 5) { taps = 0; openAdmin(); }
  });
  const checkHash = () => { if (location.hash === '#admin') openAdmin(); };
  addEventListener('hashchange', checkHash);
  checkHash();
  try { if (sessionStorage.getItem('3dw-admin')) openAdmin(); } catch { /* sin almacenamiento */ }
}

/* ---------- Inicio ---------- */

async function loadSite() {
  const res = await fetch(`data/site.json?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`site.json: ${res.status}`);
  return res.json();
}

async function init() {
  fillIcons();
  setupTheme();
  setupNav();
  setupScrollEffects();
  observeReveal();
  $('#year').textContent = new Date().getFullYear();

  try {
    app.site = await loadSite();
  } catch (err) {
    console.error(err);
    toast('No se pudo cargar el catálogo. Si abriste el archivo directo, usa un servidor local (ver README).', 'error', 10000);
    return;
  }

  try {
    const scenes = await import('./scenes.js');
    if (scenes.webglAvailable()) {
      app.grid = new scenes.GridRenderer($('#grid-canvas'));
      app.hero = new scenes.HeroViewer($('#hero-canvas'), heroCallbacks());
      app.scenes = scenes;
      new IntersectionObserver(([e]) => app.grid.setActive(e.isIntersecting), { rootMargin: '200px' }).observe($('#catalogo'));
      $('#hero-replay').addEventListener('click', () => app.hero.replay());
      if (matchMedia('(pointer: coarse)').matches) $('#drag-hint').textContent = 'Toca un color para cambiarlo';
    }
  } catch (err) {
    console.warn('3D no disponible:', err);
    app.grid = app.hero = app.scenes = null;
  }
  if (!app.scenes) {
    document.body.classList.add('no-3d');
    $('#no-webgl').hidden = false;
  }

  render();
  setupFilters();
  setupModal();
  setupUpload();
  setupSecret();
}

// API que usa el panel de administración (js/admin.js).
Object.assign(app, {
  render, toast, openModal, closeModal, waLink, esc, fillIcons, observeReveal,
  allColors, itemColors, defaultColor, itemMaterials,
});

init();
