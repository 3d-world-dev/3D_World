// Vista /figuras/: galería de figuras impresas en 3D y pintadas a mano. Muestra fotos, no modelos 3D.
// Los datos están en data/figuras.json; el contacto y la marca se toman de data/site.json.
import { ICONS } from './icons.js';

const ROOT = new URL('../', import.meta.url); // raíz del sitio, sin importar desde qué carpeta se abra
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmt = (n, d = 0) => Number(n).toLocaleString('es', { maximumFractionDigits: d });

export const STATUS = { disponible: 'Disponible', encargo: 'Por encargo', vendida: 'Vendida' };

const app = {
  site: null,
  figs: null,
  cards: [],
  hooks: {},
  localFiles: new Map(), // fotos que el dueño aún no publicó: ruta en el repo -> URL blob
  state: { filter: 'all', query: '' },
  admin: {
    file: 'data/figuras.json',
    label: 'figuras',
    editors: './admin-figuras.js',
    get: () => app.figs,
    set: (v) => { app.figs = v; },
  },
};

/* ---------- Utilidades ---------- */

const fileUrl = (path) => app.localFiles.get(path) || new URL(path, ROOT).href;

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

function priceText(item) {
  if (item.price === null || item.price === undefined || item.price === '') return 'Consultar';
  const n = Number(item.price);
  return Number.isFinite(n) ? `${app.site.pricing?.currency || '$'}${fmt(n, 2)}` : String(item.price);
}

const statusOf = (item) => (STATUS[item.status] ? item.status : 'encargo');

function interestMessage(item) {
  const name = `"${item.name}"${item.series ? ` (${item.series})` : ''}`;
  const status = statusOf(item);
  if (status === 'vendida') return `¡Hola! Vi la figura ${name} en su galería. Ya está vendida, ¿me pueden hacer una igual?`;
  if (status === 'disponible') return `¡Hola! Me interesa la figura ${name}. ¿Sigue disponible?`;
  return `¡Hola! Me interesa encargar la figura ${name}. ¿Me pueden dar precio y tiempo de entrega?`;
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

/* ---------- Render ---------- */

function render() {
  const s = app.site, f = app.figs;
  $$('[data-brand]').forEach((el) => { el.textContent = s.brand; });
  document.title = `${f.title || 'Figuras pintadas a mano'} — ${s.brand}`;
  $('#fx-title').textContent = f.title || 'Figuras pintadas a mano';
  $('#fx-intro').textContent = f.intro || '';
  $$('[data-wa]').forEach((a) => { a.href = waLink('¡Hola! Vi su galería de figuras pintadas y quiero información.'); });
  const order = waLink('¡Hola! Quiero encargar una figura pintada a mano. El personaje es: ');
  $('#order-link').href = order;
  $('#order-link-2').href = order;
  renderStats();
  renderCollage();
  renderGallery();
  renderContact();
}

function renderStats() {
  const items = app.figs.items;
  const series = new Set(items.map((i) => i.series).filter(Boolean)).size;
  const available = items.filter((i) => statusOf(i) === 'disponible').length;
  const stats = [
    [items.length, items.length === 1 ? 'figura' : 'figuras'],
    series && [series, series === 1 ? 'serie' : 'series'],
    available && [available, available === 1 ? 'disponible ya' : 'disponibles ya'],
  ].filter(Boolean);
  $('#fx-stats').innerHTML = items.length ? stats.map(([n, l]) => `<li><strong>${fmt(n)}</strong><span>${esc(l)}</span></li>`).join('') : '';
}

/* Tres fotos inclinadas en la portada: las destacadas primero. */
function renderCollage() {
  const items = app.figs.items.filter((i) => i.photos?.length);
  const picks = [...items.filter((i) => i.featured), ...items.filter((i) => !i.featured)].slice(0, 3);
  $('#fx-collage').innerHTML = picks.map((item, k) => `
    <figure class="fx-polaroid p${k + 1}">
      <img src="${esc(fileUrl(item.photos[0].thumb || item.photos[0].src))}" alt="" decoding="async">
      <figcaption>${esc(item.name)}</figcaption>
    </figure>`).join('');
  $('#fx-collage').hidden = !picks.length;
}

function renderGallery() {
  const grid = $('#grid');
  grid.innerHTML = '';
  app.cards = app.figs.items.map(buildCard);
  app.hooks.afterGrid?.(grid);
  renderChips();
  applyFilter();
}

function buildCard(item) {
  const photos = item.photos || [];
  const status = statusOf(item);
  const el = document.createElement('article');
  el.className = 'fx-card';
  el.dataset.id = item.id;
  const img = (p, cls) => `<img class="${cls}" src="${esc(fileUrl(p.thumb || p.src))}" alt="${cls === 'fx-img' ? esc(item.name) : ''}" loading="lazy" decoding="async"${p.w && p.h ? ` width="${p.w}" height="${p.h}"` : ''}>`;
  el.innerHTML = `
    <button class="fx-media" type="button" aria-label="Ver fotos de ${esc(item.name)}">
      ${photos[0] ? img(photos[0], 'fx-img') : `<span class="fx-noimg">${ICONS.cube}</span>`}
      ${photos[1] ? img(photos[1], 'fx-img fx-img-alt') : ''}
      <span class="fx-status s-${status}">${STATUS[status]}</span>
      ${photos.length > 1 ? `<span class="fx-count">${photos.length} fotos</span>` : ''}
    </button>
    <div class="fx-body">
      ${item.series ? `<p class="fx-series">${esc(item.series)}</p>` : ''}
      <h3>${esc(item.name)}</h3>
      <p class="fx-meta">${[item.height ? `${fmt(item.height, 1)} cm` : '', 'Pintada a mano'].filter(Boolean).join(' · ')}</p>
      <div class="fx-foot">
        <span class="fx-price">${esc(priceText(item))}</span>
        <a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${esc(waLink(interestMessage(item)))}">${ICONS.whatsapp}Me interesa</a>
      </div>
    </div>`;
  $('.fx-media', el).addEventListener('click', () => openLightbox(item));
  app.hooks.decorateCard?.(el, item);
  $('#grid').append(el);
  return { item, el };
}

function renderChips() {
  const series = [...new Set(app.figs.items.map((i) => i.series).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  if (app.state.filter !== 'all' && !series.includes(app.state.filter)) app.state.filter = 'all';
  const count = (c) => app.figs.items.filter((i) => c === 'all' || i.series === c).length;
  $('#chips').innerHTML = series.length < 2 ? '' : ['all', ...series].map((c) => `
    <button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === app.state.filter}">
      ${c === 'all' ? 'Todas' : esc(c)} <span>${count(c)}</span>
    </button>`).join('');
}

function applyFilter() {
  const q = norm(app.state.query.trim());
  let visible = 0;
  for (const { item, el } of app.cards) {
    const okCat = app.state.filter === 'all' || item.series === app.state.filter;
    const okQ = !q || norm(`${item.name} ${item.series} ${item.description}`).includes(q);
    el.hidden = !(okCat && okQ);
    if (!el.hidden) visible++;
  }
  const none = !app.figs.items.length;
  $('#soon').hidden = !none || document.body.classList.contains('is-admin');
  $('#empty').hidden = none || visible > 0;
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

function renderContact() {
  const c = app.site.contact;
  const digits = String(c.whatsapp || '').replace(/\D/g, '');
  const ig = String(c.instagram || '').replace(/^@/, '').trim();
  const rows = [
    { icon: 'whatsapp', label: 'WhatsApp', value: c.whatsappDisplay || `+${digits}`, href: waLink('¡Hola! Vi su galería de figuras pintadas y quiero información.'), cls: 'is-wa' },
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

/* ---------- Visor de fotos ---------- */

const lb = { item: null, index: 0 };

function openLightbox(item, index = 0) {
  const box = $('#lightbox');
  lb.item = item;
  const status = statusOf(item);
  $('#lb-series').textContent = item.series || '';
  $('#lb-title').textContent = item.name;
  const st = $('#lb-status');
  st.textContent = STATUS[status];
  st.className = `fx-status s-${status}`;
  $('#lb-desc').textContent = item.description || '';
  const specs = [
    ['Altura', item.height ? `${fmt(item.height, 1)} cm` : ''],
    ['Acabado', 'Pintada a mano'],
  ].filter(([, v]) => v);
  $('#lb-specs').innerHTML = specs.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  $('#lb-price').textContent = priceText(item);
  $('#lb-wa').href = waLink(interestMessage(item));
  const photos = item.photos || [];
  $('#lb-thumbs').innerHTML = photos.length > 1 ? photos.map((p, i) => `
    <button type="button" role="tab" data-i="${i}" aria-label="Foto ${i + 1}"><img src="${esc(fileUrl(p.thumb || p.src))}" alt="" loading="lazy"></button>`).join('') : '';
  $('#lb-prev').hidden = $('#lb-next').hidden = photos.length < 2;
  showPhoto(index);

  if (box.hidden) {
    box.hidden = false;
    requestAnimationFrame(() => box.classList.add('open'));
    document.documentElement.classList.add('modal-open');
    if (!history.state?.lightbox) history.pushState({ lightbox: true }, '');
  }
  $('.lb-close', box).focus({ preventScroll: true });
}

function showPhoto(i) {
  const photos = lb.item.photos || [];
  const img = $('#lb-img');
  if (!photos.length) {
    img.hidden = true;
    $('#lb-counter').textContent = '';
    return;
  }
  lb.index = (i + photos.length) % photos.length;
  const p = photos[lb.index];
  img.hidden = false;
  img.classList.remove('in');
  img.onload = () => img.classList.add('in');
  img.src = fileUrl(p.src);
  img.alt = `${lb.item.name}, foto ${lb.index + 1} de ${photos.length}`;
  $('#lb-counter').textContent = photos.length > 1 ? `${lb.index + 1} / ${photos.length}` : '';
  $$('#lb-thumbs button').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.i) === lb.index)));
}

function closeLightbox(fromHistory = false) {
  const box = $('#lightbox');
  if (box.hidden) return;
  box.classList.remove('open');
  document.documentElement.classList.remove('modal-open');
  setTimeout(() => { box.hidden = true; }, 250);
  if (!fromHistory && history.state?.lightbox) history.back();
}

function setupLightbox() {
  const box = $('#lightbox');
  box.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeLightbox(); });
  $('#lb-prev').addEventListener('click', () => showPhoto(lb.index - 1));
  $('#lb-next').addEventListener('click', () => showPhoto(lb.index + 1));
  $('#lb-thumbs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) showPhoto(Number(b.dataset.i));
  });
  document.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') showPhoto(lb.index - 1);
    if (e.key === 'ArrowRight') showPhoto(lb.index + 1);
  });
  window.addEventListener('popstate', () => closeLightbox(true));
  // Deslizar para cambiar de foto en el celular.
  let x0 = null;
  const media = $('#lb-media');
  media.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  media.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) showPhoto(lb.index + (dx < 0 ? 1 : -1));
  });
}

/* ---------- Efectos generales ---------- */

function setupNav() {
  const nav = $('#nav'), toggle = $('#nav-toggle'), links = $('#nav-links');
  const setOpen = (open) => {
    nav.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  };
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('menu-open')));
  links.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  const update = () => nav.classList.toggle('scrolled', scrollY > 10);
  addEventListener('scroll', update, { passive: true });
  update();
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

async function loadJSON(path) {
  const res = await fetch(new URL(`${path}?v=${Date.now()}`, ROOT), { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function init() {
  fillIcons();
  setupNav();
  $('#year').textContent = new Date().getFullYear();
  try {
    [app.site, app.figs] = await Promise.all([loadJSON('data/site.json'), loadJSON('data/figuras.json')]);
  } catch (err) {
    console.error(err);
    toast('No se pudo cargar la galería. Si abriste el archivo directo, usa un servidor local (ver README).', 'error', 10000);
    return;
  }
  app.figs.items ||= [];
  render();
  setupFilters();
  setupLightbox();
  setupSecret();
}

// API que usa el panel de administración (js/admin.js y js/admin-figuras.js).
Object.assign(app, { render, toast, esc, fileUrl, STATUS });

init();
