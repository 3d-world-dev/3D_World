// Cliente mínimo de la API de GitHub para publicar cambios desde el navegador.
const API = 'https://api.github.com';

export function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function base64ToBytes(b64) {
  return Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0));
}

async function toBase64(content) {
  if (typeof content === 'string') return bytesToBase64(new TextEncoder().encode(content));
  if (content instanceof Blob) return bytesToBase64(new Uint8Array(await content.arrayBuffer()));
  return bytesToBase64(new Uint8Array(content));
}

export class GitHubRepo {
  constructor({ owner, repo, branch = 'main', token }) {
    Object.assign(this, { owner, repo, branch, token });
    this.base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  }

  async req(path, { method = 'GET', body } = {}) {
    const res = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch { /* sin cuerpo */ }
      const err = new Error(`GitHub ${res.status}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  getRepo() {
    return this.req(this.base);
  }

  /* Lee un archivo de texto del repo. Devuelve null si no existe. */
  async getText(path) {
    try {
      const meta = await this.req(`${this.base}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(this.branch)}`);
      if (meta.content && meta.encoding === 'base64') {
        return { sha: meta.sha, text: new TextDecoder().decode(base64ToBytes(meta.content)) };
      }
      const blob = await this.req(`${this.base}/git/blobs/${meta.sha}`);
      return { sha: meta.sha, text: new TextDecoder().decode(base64ToBytes(blob.content)) };
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  /* Rutas de todos los archivos que hay ahora en la rama. */
  async listPaths() {
    const ref = await this.req(`${this.base}/git/ref/heads/${encodeURIComponent(this.branch)}`);
    const commit = await this.req(`${this.base}/git/commits/${ref.object.sha}`);
    const tree = await this.req(`${this.base}/git/trees/${commit.tree.sha}?recursive=1`);
    return new Set(tree.tree.map((t) => t.path));
  }

  /*
   * Un solo commit con varios archivos nuevos/modificados y borrados.
   * files: [{ path, content: string | Blob | ArrayBuffer }], deletions: [path]
   */
  async commit(message, { files = [], deletions = [] }, onStep = () => {}) {
    const ref = await this.req(`${this.base}/git/ref/heads/${encodeURIComponent(this.branch)}`);
    const parent = ref.object.sha;
    const parentCommit = await this.req(`${this.base}/git/commits/${parent}`);
    const tree = [];
    for (const [i, f] of files.entries()) {
      onStep(`Subiendo ${f.path} (${i + 1}/${files.length})…`);
      const blob = await this.req(`${this.base}/git/blobs`, {
        method: 'POST',
        body: { content: await toBase64(f.content), encoding: 'base64' },
      });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    if (deletions.length) {
      // Solo se borran rutas que de verdad existen; si no, GitHub rechaza el árbol.
      const existing = await this.req(`${this.base}/git/trees/${parentCommit.tree.sha}?recursive=1`);
      const paths = new Set(existing.tree.map((t) => t.path));
      for (const p of deletions) if (paths.has(p)) tree.push({ path: p, mode: '100644', type: 'blob', sha: null });
    }
    onStep('Creando commit…');
    const newTree = await this.req(`${this.base}/git/trees`, {
      method: 'POST',
      body: { base_tree: parentCommit.tree.sha, tree },
    });
    const commit = await this.req(`${this.base}/git/commits`, {
      method: 'POST',
      body: { message, tree: newTree.sha, parents: [parent] },
    });
    await this.req(`${this.base}/git/refs/heads/${encodeURIComponent(this.branch)}`, {
      method: 'PATCH',
      body: { sha: commit.sha },
    });
    return commit.sha;
  }
}
