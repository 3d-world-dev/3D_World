// Panel de administración. Solo se descarga cuando alguien activa el acceso secreto.
// Los cambios se guardan haciendo un commit al repositorio de GitHub con un token
// que se almacena cifrado (AES-GCM, clave derivada de la contraseña con PBKDF2).
import { GitHubRepo, bytesToBase64, base64ToBytes } from './github.js';
// Es común a todas las vistas: cada página indica en app.admin qué archivo de datos edita
// ({ file, get, set }) y qué módulo trae sus editores ({ editors: './admin-catalog.js' }).
import { ICONS } from './icons.js';

const SESSION_KEY = '3dw-admin';
const PBKDF2_ITERATIONS = 600000;
const MIN_PASSWORD = 12;

export const state = {
  app: null,
  gh: null,
  editors: null,
  active: false,
  baseSha: null,
  published: null,
  pending: new Map(), // ruta en el repo -> archivo (File o Blob) aún no publicado
  dirty: 0,
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const slug = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
export const uniqueId = (base, taken) => {
  base ||= 'item';
  let id = base, n = 2;
  while (taken.includes(id)) id = `${base}-${n++}`;
  return id;
};

/* ---------- Cifrado del token ---------- */

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptToken(token, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  return {
    alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(data)),
  };
}

async function decryptToken(blob, password) {
  try {
    const key = await deriveKey(password, base64ToBytes(blob.salt), blob.iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(blob.iv) }, key, base64ToBytes(blob.data));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('Contraseña incorrecta.');
  }
}

/* ---------- Sesión ---------- */

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function writeSession(s) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* sin almacenamiento */ }
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* sin almacenamiento */ }
}

/* ---------- Diálogos ---------- */

export function dialog({ title, html, submitLabel = 'Guardar', wide = false, onSubmit, onOpen, onClose }) {
  const d = document.createElement('dialog');
  d.className = `admin-dialog${wide ? ' wide' : ''}`;
  d.innerHTML = `
    <form novalidate>
      <header class="dlg-head"><h2>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-x aria-label="Cerrar">${ICONS.close}</button></header>
      <div class="dlg-body">${html}</div>
      <p class="form-error" data-error hidden></p>
      <footer class="dlg-foot">
        <button type="button" class="btn btn-ghost btn-sm" data-x>Cancelar</button>
        <button type="submit" class="btn btn-primary btn-sm" data-submit>${esc(submitLabel)}</button>
      </footer>
    </form>`;
  document.body.append(d);
  const form = d.querySelector('form');
  const errorEl = d.querySelector('[data-error]');
  d.addEventListener('close', () => { onClose?.(); d.remove(); });
  d.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => d.close()));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const btn = d.querySelector('[data-submit]');
    btn.disabled = true;
    try {
      if ((await onSubmit(form, d)) !== false) d.close();
    } catch (err) {
      console.warn(err);
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
  d.showModal();
  onOpen?.(form, d);
  return d;
}

const anyDialogOpen = () => !!document.querySelector('dialog.admin-dialog[open]');

/* ---------- Entrada ---------- */

export async function startAdmin(app) {
  state.app = app;
  if (location.hash === '#admin') history.replaceState(history.state, '', location.pathname + location.search);
  if (state.active) return app.toast('Ya estás en modo edición.');
  if (anyDialogOpen()) return;
  if (!window.isSecureContext || !crypto?.subtle) {
    return app.toast('El panel necesita HTTPS (o localhost) para funcionar.', 'error', 8000);
  }
  const saved = readSession();
  if (saved?.token) return enter(saved);
  let cfg = null;
  try {
    // Relativo a este archivo, para que funcione desde cualquier vista (/, /figuras/…).
    const res = await fetch(new URL(`../data/admin.json?v=${Date.now()}`, import.meta.url), { cache: 'no-store' });
    if (res.ok) cfg = await res.json();
  } catch { /* se trata como no configurado */ }
  if (cfg?.token) loginDialog(cfg);
  else setupDialog();
}

function loginDialog(cfg) {
  dialog({
    title: 'Acceso de administración',
    submitLabel: 'Entrar',
    html: `
      <p class="dlg-text">Ingresa la contraseña del panel para editar el catálogo.</p>
      <label class="field"><span class="field-label">Contraseña</span>
        <input type="password" name="password" autocomplete="current-password" required></label>
      <button type="button" class="text-link small" data-reset>¿Olvidaste la contraseña o cambiaste el token?</button>`,
    onOpen(form, d) {
      form.elements.password.focus();
      form.querySelector('[data-reset]').addEventListener('click', () => { d.close(); setupDialog(cfg.repo); });
    },
    async onSubmit(form) {
      const token = await decryptToken(cfg.token, form.elements.password.value);
      await enter({ ...cfg.repo, token });
    },
  });
}

function guessRepo() {
  const host = location.hostname;
  if (!host.endsWith('.github.io')) return { owner: '', repo: '' };
  const owner = host.split('.')[0];
  const first = location.pathname.split('/').filter(Boolean)[0];
  return { owner, repo: first && !first.includes('.') ? first : host };
}

function setupDialog(prev) {
  const guess = prev || guessRepo();
  dialog({
    title: 'Configurar panel de administración',
    submitLabel: 'Guardar configuración',
    html: `
      <p class="dlg-text">Esto se hace una sola vez. El token se guarda <strong>cifrado con tu contraseña</strong> en
        <code>data/admin.json</code>; nunca queda en texto plano. Instrucciones para crear el token en el README.</p>
      <div class="field-row">
        <label class="field"><span class="field-label">Usuario u organización de GitHub</span>
          <input name="owner" required value="${esc(guess.owner)}" autocomplete="off"></label>
        <label class="field"><span class="field-label">Repositorio</span>
          <input name="repo" required value="${esc(guess.repo)}" autocomplete="off"></label>
      </div>
      <label class="field"><span class="field-label">Rama <small>(vacío = la rama principal)</small></span>
        <input name="branch" value="${esc(guess.branch || '')}" placeholder="main" autocomplete="off"></label>
      <label class="field"><span class="field-label">Token de GitHub (fine-grained, permiso Contents: Read and write)</span>
        <input name="token" type="password" required autocomplete="off" placeholder="github_pat_…"></label>
      <div class="field-row">
        <label class="field"><span class="field-label">Contraseña del panel (mín. ${MIN_PASSWORD} caracteres)</span>
          <input name="password" type="password" required autocomplete="new-password" minlength="${MIN_PASSWORD}"></label>
        <label class="field"><span class="field-label">Repetir contraseña</span>
          <input name="password2" type="password" required autocomplete="new-password"></label>
      </div>`,
    async onSubmit(form) {
      const f = Object.fromEntries(new FormData(form));
      for (const k of ['owner', 'repo', 'token']) f[k] = f[k].trim();
      if (!f.owner || !f.repo || !f.token) throw new Error('Completa usuario, repositorio y token.');
      if (f.password.length < MIN_PASSWORD) throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
      if (f.password !== f.password2) throw new Error('Las contraseñas no coinciden.');
      const probe = new GitHubRepo({ owner: f.owner, repo: f.repo, token: f.token });
      let info;
      try {
        info = await probe.getRepo();
      } catch (err) {
        throw new Error(err.status === 401 ? 'Token inválido o vencido.' : err.status === 404 ? 'No se encontró el repositorio (o el token no tiene acceso a él).' : err.message);
      }
      const branch = f.branch.trim() || info.default_branch;
      const repo = { owner: f.owner, repo: f.repo, branch };
      const content = JSON.stringify({ version: 1, repo, token: await encryptToken(f.token, f.password) }, null, 2) + '\n';
      const gh = new GitHubRepo({ ...repo, token: f.token });
      try {
        await gh.commit('Configurar panel de administración', { files: [{ path: 'data/admin.json', content }] });
      } catch (err) {
        throw new Error(err.status === 403 || err.status === 404
          ? 'El token no tiene permiso de escritura (Contents: Read and write) en este repositorio.'
          : err.message);
      }
      state.app.toast('Panel configurado. A partir de ahora solo necesitas la contraseña.', 'success', 7000);
      await enter({ ...repo, token: f.token });
    },
  });
}

async function enter(session) {
  const { app } = state;
  const { file } = app.admin;
  const gh = new GitHubRepo(session);
  let remote;
  try {
    remote = await gh.getText(file);
  } catch (err) {
    clearSession();
    if (err.status === 401) {
      app.toast('El token venció o fue revocado. Configura uno nuevo.', 'error', 8000);
      setupDialog(session);
      return;
    }
    throw new Error(`No se pudo leer el repositorio: ${err.message}`);
  }
  state.editors = (await import(app.admin.editors)).install();
  state.gh = gh;
  // Se edita la versión más reciente del repo (GitHub Pages puede tardar en actualizarse).
  if (remote) app.admin.set(JSON.parse(remote.text));
  state.baseSha = remote?.sha || null;
  state.published = structuredClone(app.admin.get());
  state.pending.clear();
  state.dirty = 0;
  state.active = true;
  writeSession(session);

  document.body.classList.add('is-admin');
  app.hooks.decorateCard = state.editors.decorateCard;
  app.hooks.afterGrid = state.editors.afterGrid;
  buildBar();
  app.render();
  addEventListener('beforeunload', (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  app.toast('Modo edición activado.', 'success');
}

/* ---------- Barra y tarjetas ---------- */

function buildBar() {
  const bar = document.createElement('div');
  bar.className = 'admin-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Modo edición');
  const { actions } = state.editors;
  bar.innerHTML = `
    <span class="admin-status"><i></i><span data-status></span></span>
    ${actions.map((a) => `<button type="button" data-act="${a.id}">${a.icon}<span>${esc(a.label)}</span></button>`).join('')}
    <button type="button" data-act="publish" class="primary">${ICONS.upload}<span>Publicar</span></button>
    <button type="button" data-act="exit" aria-label="Salir del modo edición">${ICONS.logout}</button>`;
  bar.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    actions.find((a) => a.id === act)?.run();
    if (act === 'publish') publish();
    if (act === 'exit') exit();
  });
  document.body.append(bar);
  state.bar = bar;
  updateStatus();
}

function updateStatus(text) {
  if (!state.bar || (!text && state.publishing)) return; // mientras se publica se ve el progreso
  const el = state.bar.querySelector('[data-status]');
  el.textContent = text || (state.dirty ? `${state.dirty} cambio${state.dirty > 1 ? 's' : ''} sin publicar` : 'Todo publicado');
  state.bar.classList.toggle('has-changes', state.dirty > 0);
}

export function markDirty() {
  state.dirty++;
  updateStatus();
  state.app.render();
}

/* ---------- Publicar / salir ---------- */

async function publish() {
  const { app, gh } = state;
  if (state.publishing) return;
  if (!state.dirty) return app.toast('No hay cambios por publicar.');
  const btn = state.bar.querySelector('[data-act="publish"]');
  btn.disabled = true;
  updateStatus('Publicando…');
  state.publishing = true;
  const { file, get } = app.admin;
  try {
    const remote = await gh.getText(file);
    if (remote && state.baseSha && remote.sha !== state.baseSha &&
      !confirm('El catálogo se modificó desde otro dispositivo mientras editabas. ¿Publicar tus cambios de todas formas? La otra versión se reemplazará.')) {
      return;
    }
    // Copia de lo que se publica: se puede seguir editando mientras sube y esos cambios quedan pendientes.
    const data = structuredClone(get());
    const dirtyAtStart = state.dirty;
    const used = new Set(state.editors.files(data));
    const existing = await gh.listPaths();
    const missing = [...used].filter((p) => !state.pending.has(p) && !existing.has(p));
    if (missing.length && !confirm(`Estos archivos no están en el repositorio ni pendientes de subir:\n\n${missing.join('\n')}\n\nEdita esos elementos y vuelve a subir su archivo (o elimínalos). ¿Publicar de todas formas?`)) {
      return;
    }
    const uploads = [...state.pending].filter(([path]) => used.has(path));
    const files = uploads.map(([path, content]) => ({ path, content }));
    files.push({ path: file, content: `${JSON.stringify(data, null, 2)}\n` });
    const deletions = [...new Set(state.editors.files(state.published))].filter((p) => !used.has(p));
    await gh.commit(`Actualizar ${app.admin.label || 'catálogo'} desde el panel (${new Date().toLocaleString('es')})`, { files, deletions }, updateStatus);
    state.baseSha = (await gh.getText(file))?.sha || null;
    state.published = data;
    for (const [path] of uploads) state.pending.delete(path);
    state.dirty = Math.max(0, state.dirty - dirtyAtStart);
    app.toast(state.dirty
      ? 'Publicado. Los cambios que hiciste mientras se subía siguen pendientes: vuelve a pulsar Publicar.'
      : '¡Publicado! Los cambios serán visibles para todos en 1–2 minutos.', 'success', 8000);
  } catch (err) {
    console.error(err);
    app.toast(`No se pudo publicar: ${err.message}`, 'error', 10000);
  } finally {
    state.publishing = false;
    btn.disabled = false;
    updateStatus();
  }
}

function exit() {
  if (state.dirty && !confirm('Tienes cambios sin publicar. ¿Salir y descartarlos?')) return;
  state.dirty = 0;
  clearSession();
  location.reload();
}
