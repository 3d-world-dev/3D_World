# 3D World — sitio de impresión 3D

Página estática (HTML/CSS/JS, sin build) con:

- **Portada** con un modelo 3D que se "imprime" capa por capa.
- **Catálogo** de modelos 3D interactivos (girar, cambiar color, ver malla, zoom). El botón **Me interesa** abre WhatsApp con el mensaje listo.
- **Imprime tu modelo**: el cliente sube su STL/OBJ/GLB, lo ve sobre la cama de impresión, ajusta la escala y envía el pedido por WhatsApp. El archivo se procesa en su navegador y no se sube a ningún servidor.
- **Panel secreto** para que el dueño añada, edite y elimine modelos, colores, precios y datos de contacto desde la misma página.
- Modo oscuro (negro/rojo/gris) y modo claro.

## Estructura

```
index.html          Estructura de la página
css/styles.css      Estilos (colores en las variables de :root)
js/main.js          Lógica de la página
js/scenes.js        Visores 3D (Three.js)
js/models.js        Modelos de demostración generados por código
js/admin.js         Panel de administración (solo se carga al activarlo)
js/github.js        Publicación de cambios vía API de GitHub
data/site.json      TODO el contenido editable (catálogo, colores, contacto…)
data/admin.json     Se crea al configurar el panel (token cifrado)
models/             Archivos 3D subidos desde el panel
```

## Probar en tu computadora

Los navegadores bloquean `fetch` y los módulos al abrir el archivo con doble clic, así que hace falta un servidor local:

```bash
npx serve .
# o
python -m http.server 5173
```

En VS Code también puedes usar la extensión **Live Server** (clic derecho en `index.html` → *Open with Live Server*).

## Publicar en GitHub Pages (gratis)

1. Crea un repositorio en GitHub y sube todos estos archivos a la rama `main`.
2. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. En 1–2 minutos el sitio queda en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

## Configurar el panel de administración (una sola vez)

### 1. Crear el token de GitHub

1. GitHub → foto de perfil → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access**: *Only select repositories* → elige **solo** el repositorio del sitio.
3. **Permissions → Repository permissions → Contents: Read and write** (no hace falta nada más).
4. **Expiration**: lo que prefieras (máx. 1 año). Cuando venza, crea otro y repite el paso 2.
5. Copia el token (empieza con `github_pat_`).

### 2. Configurar la contraseña en el sitio

1. Abre el sitio publicado y entra a `…/#admin` (o toca **5 veces seguidas el logo del pie de página**).
2. Completa usuario, repositorio, token y una contraseña de **al menos 12 caracteres**.
3. Listo: se crea `data/admin.json` con el token **cifrado**. Desde ahora, en cualquier dispositivo, basta con el acceso secreto y la contraseña.

> Si olvidas la contraseña o venció el token: abre el acceso secreto y usa *"¿Olvidaste la contraseña o cambiaste el token?"*. Necesitarás un token válido.

### Uso del panel

- Barra inferior: **+ Modelo**, **Colores**, **Datos** (nombre, WhatsApp, Instagram, email, ubicación, horario, moneda), **Publicar** y **Salir**.
- Cada tarjeta muestra **Editar** y **Eliminar**.
- Al subir un archivo 3D, las medidas se calculan solas (en mm).
- Los cambios se ven al instante en tu pantalla, pero **solo se guardan al pulsar Publicar**. Eso crea un commit en el repo, y GitHub Pages actualiza el sitio para todos en 1–2 minutos.
- Si cierras la pestaña, la sesión se cierra sola.

## Seguridad

- **El contenido del catálogo es público** a propósito (nombres, precios, colores, WhatsApp): no se cifra porque los visitantes tienen que poder verlo.
- **El token** se guarda cifrado con AES-256-GCM, con una clave derivada de tu contraseña (PBKDF2-SHA256, 600 000 iteraciones). El archivo cifrado es público en el repo, así que usa una contraseña larga y única. Además, el token solo tiene acceso a este repositorio.
- Mientras el panel está abierto, el token descifrado vive solo en esa pestaña (`sessionStorage`).
- Todo el texto que escribe el dueño se muestra como texto, nunca como HTML.
- `index.html` incluye una **Content-Security-Policy** que solo permite scripts propios y Three.js desde jsdelivr. Si modificas alguno de los dos `<script>` en línea de `index.html` (el del tema o el `importmap`), recalcula sus hashes:

  ```bash
  node -e "const h=require('fs').readFileSync('index.html','utf8');for(const m of h.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g))console.log('sha256-'+require('crypto').createHash('sha256').update(m[1]).digest('base64'))"
  ```

- Los archivos que suben los clientes en "Imprime tu modelo" nunca salen de su navegador.

## Editar a mano (sin panel)

Todo está en `data/site.json`:

| Campo | Qué es |
|---|---|
| `brand`, `tagline` | Nombre y frase del negocio |
| `contact.whatsapp` | Número con código de país, solo dígitos (ej. `5215512345678`) |
| `printer` | Volumen de impresión en mm y altura de capa |
| `pricing.perGram` | Si pones un número, "Imprime tu modelo" muestra un precio estimado |
| `colors`, `materials` | Colores de filamento y materiales |
| `items` | Catálogo. `model` puede ser `models/archivo.stl` o un modelo demo `procedural:…` |

En `items`, `price: null` muestra "Cotizar". Si `colors` o `materials` quedan vacíos (`[]`), el modelo usa todos los disponibles.
